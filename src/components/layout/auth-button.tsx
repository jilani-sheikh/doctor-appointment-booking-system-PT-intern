"use client";

import { signInAction, signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { useTransition } from "react";

interface AuthButtonProps {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

export function AuthButton({ user }: AuthButtonProps) {
  const [isPending, startTransition] = useTransition();

  if (!user) {
    return (
      <form
        action={() => {
          startTransition(async () => {
            try {
              await signInAction();
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : "Authentication failed";
              alert(message);
            }
          });
        }}
      >
        <Button
          type="submit"
          disabled={isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex items-center gap-2 cursor-pointer shadow-sm transition-all"
        >
          <LogIn className="h-4 w-4" />
          {isPending ? "Connecting..." : "Sign In"}
        </Button>
      </form>
    );
  }

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

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
            <p className="text-sm font-semibold leading-none text-foreground">{user.name ?? "User"}</p>
            {user.email && (
              <p className="text-xs leading-none text-muted-foreground truncate">{user.email}</p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1 border-border" />
        <DropdownMenuItem className="cursor-default text-xs text-muted-foreground flex items-center gap-2">
          <UserIcon className="h-3.5 w-3.5 text-primary" />
          <span>Patient Account</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 border-border" />
        <form
          action={() => {
            startTransition(async () => {
              await signOutAction();
            });
          }}
        >
          <button
            type="submit"
            disabled={isPending}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-sm cursor-pointer transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span>{isPending ? "Signing out..." : "Sign Out"}</span>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
