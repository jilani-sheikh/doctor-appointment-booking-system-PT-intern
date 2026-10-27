import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema";
import { getAuthSecret } from "@/lib/env";
import { redirect } from "next/navigation";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: {
    // Fast, edge-friendly JWT session strategy. Drizzle adapter persists users/accounts on login.
    strategy: "jwt",
  },
  secret: getAuthSecret(),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});

/**
 * Retrieves the currently authenticated user in a Server Component or Server Action.
 * Returns null if not authenticated.
 */
export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * Enforces authentication in protected Server Components.
 * Redirects to the sign-in page if no active session is found.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/api/auth/signin");
  }
  return user;
}
