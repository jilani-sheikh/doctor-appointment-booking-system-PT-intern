"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

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
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="User menu"
        className="rounded-full ring-2 ring-primary/20 hover:ring-primary/40 focus:outline-none focus:ring-2 focus:ring-primary transition-all cursor-pointer p-0 border-0 bg-transparent flex items-center"
      >
        <Avatar className="h-9 w-9">
          {user.image && <AvatarImage src={user.image} alt={user.name ?? "User avatar"} />}
          <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
            {initials}
          </AvatarFallback>
        </Avatar>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border bg-card p-2 text-card-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-100 focus:outline-none"
        >
          {/* User Information */}
          <div className="px-2.5 py-2">
            <p className="text-sm font-semibold leading-none text-foreground truncate">
              {user.name ?? "User"}
            </p>
            {user.email && (
              <p className="text-xs leading-none text-muted-foreground truncate mt-1">
                {user.email}
              </p>
            )}
            <div className="pt-2 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {user.role === "ADMIN" && <Shield className="h-3 w-3" />}
                {user.role === "DOCTOR" && <Stethoscope className="h-3 w-3" />}
                {user.role === "PATIENT" && <UserIcon className="h-3 w-3" />}
                {roleLabel}
              </span>
            </div>
          </div>

          <div className="my-1 border-t border-border" />

          {/* Navigation link */}
          <Link
            href={dashboardUrl}
            onClick={() => setIsOpen(false)}
            role="menuitem"
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-sm cursor-pointer hover:bg-muted rounded-md transition-colors text-foreground font-medium"
          >
            <LayoutDashboard className="h-4 w-4 text-primary" />
            <span>{user.role ? "Dashboard" : "Complete Profile"}</span>
          </Link>

          <div className="my-1 border-t border-border" />

          {/* Sign Out Action */}
          <div className="px-0.5 pt-0.5">
            <SignOutButton
              variant="dropdown"
              onClick={() => setIsOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
