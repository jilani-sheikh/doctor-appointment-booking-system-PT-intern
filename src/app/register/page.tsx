import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, getPostLoginRedirect } from "@/lib/auth";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Register — Medrella",
  description: "Create your Medrella account to book appointments or manage your medical availability.",
};

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(getPostLoginRedirect(user));
  }

  return (
    <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <RegisterForm />
    </div>
  );
}
