import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { getAuthSecret, isAdminEmail, isDatabaseConfigured } from "@/lib/env";
import { signInSchema } from "@/lib/validations/auth";
import { Role, type User as PrismaUser, type Patient, type Doctor } from "@/generated/prisma/client";
import { redirect, unstable_rethrow } from "next/navigation";

// Constant-time dummy hash for timing-attack defense on unknown emails (bcrypt cost 12)
const DUMMY_HASH = "$2b$12$W7cZLbg2wRkIqumErxXbheoBLT3Q72qRXCr4u0u1iXb5GY1y2VKQK";

export class GoogleAccountRegisteredError extends CredentialsSignin {
  code = "oauth_account_registered";
}

export type CurrentUser = PrismaUser & {
  patient: Patient | null;
  doctor: Doctor | null;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: {
    // Fast, edge-friendly JWT session strategy required for Credentials provider
    strategy: "jwt",
  },
  secret: getAuthSecret(),
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const email = parsed.data.email.trim().toLowerCase();
        const password = parsed.data.password;

        const user = await db.user.findUnique({
          where: { email },
        });

        if (!user) {
          // Timing-attack defense: run constant-time dummy compare
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }

        if (!user.passwordHash) {
          // Account exists via Google OAuth (no credentials password set)
          await bcrypt.compare(password, DUMMY_HASH);
          throw new GoogleAccountRegisteredError();
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.role = (token.role as Role) ?? null;
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account, profile }) {
      // Auto-promote Google OAuth sign-ins matching ADMIN_EMAILS (only if verified by Google)
      if (
        account?.provider === "google" &&
        (profile as Record<string, unknown> | undefined)?.email_verified === true
      ) {
        if (user.email && isAdminEmail(user.email) && user.id) {
          try {
            await db.user.update({
              where: { id: user.id },
              data: { role: Role.ADMIN },
            });
          } catch (err) {
            console.error("[Medrella Auth] Failed to auto-promote Google admin:", err);
          }
        }
      }
    },
  },
});

/**
 * Checks whether a user's role and corresponding profile are fully initialized.
 * ADMIN has no profile table and is considered complete once role is ADMIN.
 */
export function isProfileComplete(user: CurrentUser | null): boolean {
  if (!user || !user.role) return false;
  if (user.role === Role.ADMIN) return true;
  if (user.role === Role.PATIENT) return Boolean(user.patient);
  if (user.role === Role.DOCTOR) return Boolean(user.doctor);
  return false;
}

/**
 * Determines the target dashboard or onboarding route based on current user state.
 */
export function getPostLoginRedirect(user: CurrentUser | null): string {
  if (!user) return "/sign-in";
  if (!user.role || !isProfileComplete(user)) return "/onboarding";
  switch (user.role) {
    case Role.PATIENT:
      return "/patient/dashboard";
    case Role.DOCTOR:
      return "/doctor/dashboard";
    case Role.ADMIN:
      return "/admin/dashboard";
    default:
      return "/onboarding";
  }
}

/**
 * Retrieves the currently authenticated user in a Server Component or Server Action.
 * Does NOT call auth() or query the database unless a session cookie exists and database is configured.
 * Gracefully degrades to null if any database connection issue occurs.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const hasToken =
      cookieStore.has("authjs.session-token") ||
      cookieStore.has("__Secure-authjs.session-token") ||
      cookieStore.has("next-auth.session-token") ||
      cookieStore.has("__Secure-next-auth.session-token");

    if (!hasToken) {
      return null;
    }

    const session = await auth();
    if (!session?.user?.id) {
      return null;
    }

    if (!isDatabaseConfigured()) {
      return null;
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      include: {
        patient: true,
        doctor: true,
      },
    });
    return user ?? null;
  } catch (err) {
    unstable_rethrow(err);
    console.warn("[Medrella Auth] Failed to load user, degrading to null:", err);
    return null;
  }
}

/**
 * Enforces authentication in protected Server Components.
 * Redirects to /sign-in if no active session is found.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }
  return user;
}

/**
 * Enforces role-based authorization in protected Server Components.
 * Redirects incomplete profiles to /onboarding, and unauthorized roles to their own dashboard.
 */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();

  if (!user.role || !isProfileComplete(user)) {
    redirect("/onboarding");
  }

  if (!roles.includes(user.role)) {
    redirect(getPostLoginRedirect(user));
  }

  return user;
}
