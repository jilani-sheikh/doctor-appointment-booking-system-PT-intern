import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isProfileComplete, getPostLoginRedirect } from "@/lib/auth";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Account Onboarding — Medrella",
  description: "Complete your Medrella profile as a patient or medical doctor.",
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();

  // If unauthenticated, redirect to sign-in
  if (!user) {
    redirect("/sign-in");
  }

  // If already onboarded, redirect to role-specific dashboard
  if (isProfileComplete(user)) {
    redirect(getPostLoginRedirect(user));
  }

  return (
    <div className="flex-1 py-12 px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center space-y-4">
      <OnboardingFlow userName={user.name} />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          Signed in as <strong className="text-foreground">{user.email ?? user.name}</strong>
        </span>
        <span>•</span>
        <SignOutButton
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          Sign out
        </SignOutButton>
      </div>
    </div>
  );
}
