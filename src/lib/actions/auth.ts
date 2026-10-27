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
import { Role, DoctorStatus } from "@/generated/prisma/client";
import { AuthError } from "next-auth";

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
export async function signOutAction() {
  await signOut({ redirectTo: "/" });
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
    return {
      success: false,
      error: "Onboarding has already been completed for this account.",
    };
  }

  const parsed = onboardingSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.errors[0]?.message ?? "Invalid onboarding data",
    };
  }

  try {
    const validated = parsed.data;

    await db.$transaction(async (tx) => {
      // Conditional update: only succeed if user.role is currently NULL
      const updateResult = await tx.user.updateMany({
        where: {
          id: user.id,
          role: null,
        },
        data: {
          role: validated.role === "PATIENT" ? Role.PATIENT : Role.DOCTOR,
        },
      });

      if (updateResult.count === 0) {
        throw new Error("Onboarding has already been completed or role is already assigned.");
      }

      if (validated.role === "PATIENT") {
        await tx.patient.create({
          data: {
            userId: user.id,
            dateOfBirth: new Date(validated.dateOfBirth),
            gender: validated.gender,
            phone: validated.phone,
          },
        });
      } else if (validated.role === "DOCTOR") {
        await tx.doctor.create({
          data: {
            userId: user.id,
            specialization: validated.specialization,
            qualification: validated.qualification,
            consultationFee: validated.consultationFee,
            experienceYears: validated.experienceYears,
            bio: validated.bio || null,
            status: DoctorStatus.PENDING,
            isDemo: false,
          },
        });
      }
    });

    const redirectUrl =
      validated.role === "PATIENT" ? "/patient/dashboard" : "/doctor/dashboard";

    return { success: true, redirectUrl };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete onboarding.";
    console.error("[Medrella Onboarding Error]:", err);
    return { success: false, error: message };
  }
}
