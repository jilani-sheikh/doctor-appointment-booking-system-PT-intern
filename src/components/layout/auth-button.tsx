"use client";

import * as React from "react";
import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { signInAction, signOutAction } from "@/lib/actions/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogIn, LogOut, LayoutDashboard, Shield, Stethoscope, User as UserIcon, Loader2 } from "lucide-react";
import type { NavUser } from "@/lib/serializers";

interface AuthButtonProps {
  user?: NavUser | null;
}

export function AuthButton({ user }: AuthButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isGooglePending, startGoogleTransition] = useTransition();
  const [isSignOutPending, startSignOutTransition] = useTransition();
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
      <div className="flex items-center gap-2">
        {/* Direct Google Sign-In option on homepage & navbar */}
        <form
          action={() => {
            startGoogleTransition(async () => {
              try {
                await signInAction();
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Google authentication failed";
                alert(message);
              }
            });
          }}
        >
          <Button
            type="submit"
            disabled={isGooglePending}
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex items-center gap-2 font-medium border-border hover:bg-muted text-foreground cursor-pointer shadow-xs"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>{isGooglePending ? "Connecting..." : "Google Sign-In"}</span>
          </Button>
        </form>

        {/* Regular Sign In Link */}
        <Link
          href="/sign-in"
          className={buttonVariants({
            variant: "default",
            size: "sm",
            className:
              "bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex items-center gap-1.5 cursor-pointer shadow-xs",
          })}
        >
          <LogIn className="h-4 w-4" />
          <span>Sign In</span>
        </Link>
      </div>
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

          {/* Sign Out Action inside Dropdown */}
          <form
            action={() => {
              setIsOpen(false);
              startSignOutTransition(async () => {
                await signOutAction();
              });
            }}
            className="w-full"
          >
            <button
              type="submit"
              disabled={isSignOutPending}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-md cursor-pointer transition-colors text-left"
            >
              {isSignOutPending ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              ) : (
                <LogOut className="h-4 w-4 shrink-0" />
              )}
              <span>{isSignOutPending ? "Signing out..." : "Sign Out"}</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
