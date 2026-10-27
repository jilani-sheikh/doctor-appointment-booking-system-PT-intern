"use client";

import * as React from "react";
import { useTransition } from "react";
import { signOutAction } from "@/lib/actions/auth";
import { LogOut, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

export interface SignOutButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "dropdown";
  size?: "default" | "sm" | "lg" | "icon";
  showIcon?: boolean;
  redirectTo?: string;
  children?: React.ReactNode;
}

export function SignOutButton({
  variant = "outline",
  size = "sm",
  showIcon = true,
  redirectTo = "/",
  className,
  children,
  disabled,
  ...props
}: SignOutButtonProps) {
  const [isPending, startTransition] = useTransition();

  const handleAction = () => {
    startTransition(async () => {
      try {
        await signOutAction(redirectTo);
      } catch (error) {
        // Next.js redirection throws NEXT_REDIRECT, which should be re-thrown
        if ((error as Error)?.message?.includes("NEXT_REDIRECT")) {
          throw error;
        }
        console.error("[Medrella Auth] Sign out error:", error);
      }
    });
  };

  if (variant === "dropdown") {
    return (
      <form action={handleAction} className="w-full">
        <button
          type="submit"
          disabled={isPending || disabled}
          aria-label="Sign out of account"
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-sm cursor-pointer transition-colors text-left",
            className
          )}
          {...props}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          ) : (
            showIcon && <LogOut className="h-4 w-4 shrink-0" />
          )}
          <span>{children ?? (isPending ? "Signing out..." : "Sign Out")}</span>
        </button>
      </form>
    );
  }

  return (
    <form action={handleAction} className="inline-block">
      <button
        type="submit"
        disabled={isPending || disabled}
        aria-label="Sign out of account"
        className={cn(
          buttonVariants({
            variant,
            size,
          }),
          "cursor-pointer flex items-center gap-1.5",
          className
        )}
        {...props}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        ) : (
          showIcon && <LogOut className="h-4 w-4 shrink-0" />
        )}
        <span>{children ?? (isPending ? "Signing out..." : "Sign Out")}</span>
      </button>
    </form>
  );
}
