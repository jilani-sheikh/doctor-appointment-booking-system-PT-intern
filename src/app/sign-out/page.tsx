import { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, ArrowLeft, CheckCircle2, Shield, Stethoscope, User as UserIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign Out — Medrella",
  description: "Sign out of your Medrella medical consultation account.",
};

export default async function SignOutPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="container mx-auto max-w-md px-4 py-16 flex items-center justify-center min-h-[60vh]">
        <Card className="w-full border-border shadow-md text-center p-4">
          <CardHeader className="space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl font-bold">You are signed out</CardTitle>
            <CardDescription>
              There is no active session found. You can sign in to access your appointments and medical records.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col sm:flex-row gap-2 pt-2">
            <Link
              href="/sign-in"
              className={buttonVariants({ variant: "default", className: "w-full" })}
            >
              Sign In
            </Link>
            <Link
              href="/"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
            >
              Return Home
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .filter(Boolean)
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email
    ? user.email.slice(0, 2).toUpperCase()
    : "U";

  const dashboardUrl =
    user.role === "PATIENT"
      ? "/patient/dashboard"
      : user.role === "DOCTOR"
      ? "/doctor/dashboard"
      : user.role === "ADMIN"
      ? "/admin/dashboard"
      : "/onboarding";

  const roleLabel =
    user.role === "PATIENT"
      ? "Patient"
      : user.role === "DOCTOR"
      ? "Doctor"
      : user.role === "ADMIN"
      ? "Administrator"
      : "Incomplete Profile";

  return (
    <div className="container mx-auto max-w-md px-4 py-16 flex items-center justify-center min-h-[60vh]">
      <Card className="w-full border-border shadow-lg">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-1">
            <LogOut className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Sign out of Medrella</CardTitle>
          <CardDescription>
            Are you sure you want to sign out of your account on this device?
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/40">
            <Avatar className="h-10 w-10">
              {user.image && <AvatarImage src={user.image} alt={user.name ?? "User"} />}
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate text-foreground">{user.name ?? "User"}</p>
              {user.email && (
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              )}
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
              {user.role === "ADMIN" && <Shield className="h-3 w-3" />}
              {user.role === "DOCTOR" && <Stethoscope className="h-3 w-3" />}
              {user.role === "PATIENT" && <UserIcon className="h-3 w-3" />}
              {roleLabel}
            </span>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-2 pt-2">
          <SignOutButton
            variant="destructive"
            size="default"
            className="w-full justify-center"
          >
            Confirm Sign Out
          </SignOutButton>
          <Link
            href={dashboardUrl}
            className={buttonVariants({ variant: "outline", className: "w-full flex items-center justify-center gap-1.5" })}
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Cancel, Return to Dashboard</span>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
