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
import {
  DeliveryStatus,
  NotificationChannel,
  Role,
  DoctorStatus,
  Prisma,
} from "@/generated/prisma/client";
import { AuthError } from "next-auth";
import { createHash, randomBytes } from "node:crypto";
import { sendEmail } from "@/lib/email/client";
import {
  renderGoogleAccountPasswordEmail,
  renderPasswordResetEmail,
} from "@/lib/email/templates";
import {
  passwordResetRequestSchema,
  passwordResetSchema,
  type PasswordResetInput,
  type PasswordResetRequestInput,
} from "@/lib/validations/auth";
import { getAppUrl } from "@/lib/env";

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

const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_MAX_REQUESTS = 3;

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordResetAction(data: PasswordResetRequestInput) {
  const parsed = passwordResetRequestSchema.safeParse(data);
  const genericMessage = "If an account exists for this email, we have sent a reset link.";
  if (!parsed.success) return { success: false, error: "Please enter a valid email address." };

  const email = parsed.data.email;
  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      console.warn("[Password Reset Warning] Request ignored: account not found.");
      return { success: true, message: genericMessage };
    }

    const since = new Date(Date.now() - PASSWORD_RESET_WINDOW_MS);
    const recentRequests = await db.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gte: since } },
    });
    if (recentRequests >= PASSWORD_RESET_MAX_REQUESTS) {
      console.warn("[Password Reset Warning] Request rate limited: email threshold reached.");
      return { success: true, message: genericMessage };
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    if (!user.passwordHash) {
      const result = await sendEmail({
        to: email,
        subject: "Use Google to sign in to Medrella",
        ...renderGoogleAccountPasswordEmail(),
      });
      if (!result.success) {
        console.warn(`[Password Reset Warning] Google guidance email failed: ${result.error ?? "unknown email error"}`);
      }
      return { success: true, message: genericMessage };
    }

    const rawToken = randomBytes(32).toString("hex");
    await db.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashResetToken(rawToken), expiresAt },
      });
    });

    const resetUrl = `${getAppUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const delivery = await db.notificationDelivery.create({
      data: {
        userId: user.id,
        channel: NotificationChannel.EMAIL,
        template: "password_reset",
        payload: {},
        dedupeKey: `password-reset:${user.id}:${hashResetToken(rawToken)}`,
        scheduledFor: new Date(),
        status: DeliveryStatus.PROCESSING,
      },
    });
    const result = await sendEmail({
      to: email,
      subject: "Reset your Medrella password",
      ...renderPasswordResetEmail({ resetUrl, expiresAt }),
    });
    if (result.success) {
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: DeliveryStatus.SENT, sentAt: new Date(), lockedAt: null },
      });
    } else {
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.FAILED,
          attempts: 1,
          lastError: result.error ?? "Email delivery failed",
          lockedAt: null,
        },
      });
      console.warn(`[Password Reset Warning] Reset email failed: ${result.error ?? "unknown email error"}`);
    }
    return { success: true, message: genericMessage };
  } catch {
    console.warn("[Password Reset Warning] Request failed: database or token persistence error.");
    return { success: true, message: genericMessage };
  }
}

export async function resetPasswordAction(data: PasswordResetInput) {
  const parsed = passwordResetSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid password reset details." };

  const tokenHash = hashResetToken(parsed.data.token);
  const token = await db.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!token) return { success: false, error: "This reset link is invalid." };
  if (token.usedAt) return { success: false, error: "This reset link has already been used." };
  if (token.expiresAt <= new Date()) return { success: false, error: "This reset link has expired. Please request a new one." };

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new Error("RESET_TOKEN_UNAVAILABLE");
      await tx.user.update({
        where: { id: token.userId, deletedAt: null },
        data: { passwordHash, passwordChangedAt: now },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: token.userId, usedAt: null },
        data: { usedAt: now },
      });
    });
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === "RESET_TOKEN_UNAVAILABLE") {
      return { success: false, error: "This reset link is invalid, expired, or already used." };
    }
    console.error("[Password Reset] Reset failed:", error instanceof Error ? error.message : "unknown error");
    return { success: false, error: "Unable to reset your password. Please request a new link." };
  }
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
