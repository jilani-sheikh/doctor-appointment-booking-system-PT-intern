"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LogIn, LayoutDashboard, Shield, Stethoscope, User as UserIcon } from "lucide-react";
import type { Role } from "@/generated/prisma/client";

interface AuthButtonProps {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: Role | null;
  } | null;
}

export function AuthButton({ user }: AuthButtonProps) {
  if (!user) {
    return (
      <Link
        href="/sign-in"
        className={buttonVariants({
          variant: "default",
          className:
            "bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex items-center gap-2 cursor-pointer shadow-sm transition-all",
        })}
      >
        <LogIn className="h-4 w-4" />
        <span>Sign In</span>
      </Link>
    );
  }

  // Generate uppercase initials from name or email
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
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="User menu"
        className="rounded-full ring-2 ring-primary/20 hover:ring-primary/40 focus:outline-none focus:ring-2 focus:ring-primary transition-all cursor-pointer p-0 border-0 bg-transparent"
      >
        <Avatar className="h-9 w-9">
          {user.image && <AvatarImage src={user.image} alt={user.name ?? "User avatar"} />}
          <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-2 bg-card text-card-foreground shadow-lg border border-border">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-semibold leading-none text-foreground truncate">
              {user.name ?? "User"}
            </p>
            {user.email && (
              <p className="text-xs leading-none text-muted-foreground truncate">{user.email}</p>
            )}
            <div className="pt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {user.role === "ADMIN" && <Shield className="h-3 w-3" />}
                {user.role === "DOCTOR" && <Stethoscope className="h-3 w-3" />}
                {user.role === "PATIENT" && <UserIcon className="h-3 w-3" />}
                {roleLabel}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1 border-border" />
        <DropdownMenuItem
          render={
            <Link
              href={dashboardUrl}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted rounded-sm transition-colors text-foreground"
            />
          }
        >
          <LayoutDashboard className="h-4 w-4 text-primary" />
          <span>{user.role ? "Dashboard" : "Complete Profile"}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 border-border" />
        <SignOutButton variant="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
