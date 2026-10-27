import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, getPostLoginRedirect } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign In — Medrella",
  description: "Sign in to your Medrella account using your email or Google account.",
};

interface SignInPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  // If already authenticated, redirect to role-specific dashboard or onboarding
  const user = await getCurrentUser();
  if (user) {
    redirect(getPostLoginRedirect(user));
  }

  const resolvedParams = await searchParams;
  const errorParam = resolvedParams.error;

  let initialError: string | undefined;
  if (errorParam === "OAuthAccountNotLinked") {
    initialError =
      "An account already exists with this email address. Please sign in with your email and password.";
  } else if (errorParam === "OAuthCallbackError") {
    initialError = "Google authentication was cancelled or failed. Please try again.";
  } else if (errorParam === "CredentialsSignin") {
    initialError = "Invalid email or password.";
  } else if (typeof errorParam === "string" && errorParam.length > 0) {
    initialError = "Authentication failed. Please verify your credentials.";
  }

  return (
    <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <SignInForm initialError={initialError} />
    </div>
  );
}
