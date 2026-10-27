import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isProfileComplete, getPostLoginRedirect } from "@/lib/auth";
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
    <div className="flex-1 py-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <OnboardingFlow userName={user.name} />
    </div>
  );
}
