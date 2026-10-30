"use server";

import { signIn, signOut, getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/env";
import bcrypt from "bcryptjs";
import {
  signInSchema,
  registerSchema,
  onboardingSchema,
  type SignInInput,
  type RegisterInput,
  type OnboardingInput,
} from "@/lib/validations/auth";
import { Role, DoctorStatus, Prisma } from "@/generated/prisma/client";
import { AuthError } from "next-auth";
import { z } from "zod";

/**
 * Server Action to trigger Google OAuth sign-in.
 */
export async function signInAction() {
  if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
    throw new Error(
      "[Medrella Auth Error] Missing Google OAuth credentials.\n" +
      "Please set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in your .env.local file to enable Google Sign-In."
    );
  }
  await signIn("google");
}

/**
 * Server Action to trigger user sign-out and redirect to home.
 */
export async function signOutAction(redirectTo: string = "/") {
  await signOut({ redirectTo });
}

/**
 * Server Action for credentials-based sign in.
 */
export async function credentialsSignInAction(data: SignInInput) {
  const parsed = signInSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.errors[0]?.message ?? "Invalid sign-in credentials",
    };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    return { success: true };
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      if (err.type === "CredentialsSignin") {
        return { success: false, error: "Invalid email or password." };
      }
      const message = err.message || "";
      const code = (err as unknown as { code?: string }).code;
      if (message.includes("oauth_account_registered") || code === "oauth_account_registered") {
        return {
          success: false,
          error: "This email is registered with Google. Use Continue with Google.",
        };
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("oauth_account_registered") || message.includes("GoogleAccountRegisteredError")) {
      return {
        success: false,
        error: "This email is registered with Google. Use Continue with Google.",
      };
    }

    return {
      success: false,
      error: "Invalid email or password.",
    };
  }
}

/**
 * Server Action for new user registration.
 */
export async function registerAction(data: RegisterInput) {
  const parsed = registerSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.errors[0]?.message ?? "Invalid registration details",
    };
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  // Prevent account squatting on administrative email addresses
  if (isAdminEmail(email)) {
    return {
      success: false,
      error: "This email is reserved for administrative access. Please sign in with Google.",
    };
  }

  try {
    const existing = await db.user.findUnique({
      where: { email },
    });

    if (existing) {
      if (!existing.passwordHash) {
        return {
          success: false,
          error: "This email is registered with Google. Use Continue with Google.",
        };
      }
      return {
        success: false,
        error: "An account with this email already exists. Please sign in.",
      };
    }

    // Hash password with bcrypt cost 12
    const passwordHash = await bcrypt.hash(password, 12);

    await db.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: null,
      },
    });

    return { success: true };
  } catch (err) {
    console.error("[Medrella Registration Error]:", err);
    return {
      success: false,
      error: "Failed to create account. Please try again later.",
    };
  }
}

/**
 * Server Action for onboarding completion.
 * Enforces atomic single-use submission: updates user.role conditionally where role IS NULL.
 */
export async function completeOnboardingAction(data: OnboardingInput) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Authentication required. Please sign in." };
  }

  if (user.role) {
    const redirectUrl =
      user.role === Role.DOCTOR
        ? "/doctor/dashboard"
        : user.role === Role.ADMIN
        ? "/admin/dashboard"
        : "/patient/dashboard";

    return {
      success: false,
      error: "You have already completed onboarding.",
      redirectUrl,
    };
  }

  const parsed = onboardingSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.errors[0]?.message ?? "Invalid onboarding data",
    };
  }

  const validated = parsed.data;

  try {
    if (validated.role === "PATIENT") {
      await db.user.update({
        where: {
          id: user.id,
          role: null,
        },
        data: {
          role: Role.PATIENT,
          patient: {
            create: {
              dateOfBirth: new Date(validated.dateOfBirth),
              gender: validated.gender,
              phone: validated.phone,
              whatsappOptIn: validated.whatsappOptIn,
              whatsappOptInAt: validated.whatsappOptIn ? new Date() : null,
            },
          },
        },
      });
    } else if (validated.role === "DOCTOR") {
      await db.user.update({
        where: {
          id: user.id,
          role: null,
        },
        data: {
          role: Role.DOCTOR,
          doctor: {
            create: {
              specialization: validated.specialization,
              qualification: validated.qualification,
              consultationFee: validated.consultationFee,
              experienceYears: validated.experienceYears,
              bio: validated.bio || null,
              status: DoctorStatus.PENDING,
              isDemo: false,
            },
          },
        },
      });
    }

    const redirectUrl =
      validated.role === "PATIENT" ? "/patient/dashboard" : "/doctor/dashboard";

    return { success: true, redirectUrl };
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      // User record not found or role was already non-null (concurrent submission / already onboarded)
      const existingUser = await db.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });
      const role = existingUser?.role || (validated.role === "DOCTOR" ? Role.DOCTOR : Role.PATIENT);
      const redirectUrl =
        role === Role.DOCTOR
          ? "/doctor/dashboard"
          : role === Role.ADMIN
          ? "/admin/dashboard"
          : "/patient/dashboard";

      return {
        success: false,
        error: "You have already completed onboarding.",
        redirectUrl,
      };
    }

    console.error("[Medrella Onboarding Error]:", err);
    return {
      success: false,
      error: "Failed to complete onboarding. Please try again.",
    };
  }
}

export async function updateWhatsAppOptInAction(input: { whatsappOptIn: boolean }) {
  const user = await getCurrentUser();
  if (!user || user.role !== Role.PATIENT || !user.patient) {
    return { success: false, error: "Patient access is required." };
  }
  const parsed = z.object({ whatsappOptIn: z.boolean() }).safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid WhatsApp preference." };
  await db.patient.update({
    where: { userId: user.id },
    data: {
      whatsappOptIn: parsed.data.whatsappOptIn,
      whatsappOptInAt: parsed.data.whatsappOptIn ? new Date() : null,
    },
  });
  if (!parsed.data.whatsappOptIn) {
    await db.notificationDelivery.updateMany({
      where: { userId: user.id, channel: "WHATSAPP", status: "PENDING" },
      data: { status: "CANCELLED", lastError: "WhatsApp opted out by patient" },
    });
  }
  return { success: true };
}
