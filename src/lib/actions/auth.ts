"use server";

import { signIn, signOut } from "@/lib/auth";

/**
 * Server Action to trigger Google OAuth sign-in.
 * Validates Google OAuth environment variables before starting the flow.
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
