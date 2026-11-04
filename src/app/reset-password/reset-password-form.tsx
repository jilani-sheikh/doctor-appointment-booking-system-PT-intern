"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { resetPasswordAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LockKeyhole } from "lucide-react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(token ? null : "This reset link is invalid.");
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await resetPasswordAction({ token, password, confirmPassword });
      if (!result.success) {
        const errorMessage = result.error ?? "Unable to reset your password.";
        setError(errorMessage);
        toast.error(errorMessage);
        return;
      }
      setError(null);
      setSuccess(true);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>Choose a password with at least 8 characters, including a letter and a number.</CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="space-y-3 text-sm">
            <p className="rounded-md bg-primary/10 p-3">Your password was reset successfully.</p>
            <Link href="/sign-in" className="inline-flex text-primary font-semibold hover:underline">Continue to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            <div className="space-y-1">
              <Label htmlFor="reset-password">New password</Label>
              <Input id="reset-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reset-confirm-password">Confirm password</Label>
              <Input id="reset-confirm-password" type="password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={isPending || !token}>
              <LockKeyhole className="h-4 w-4 mr-2" />
              {isPending ? "Resetting..." : "Reset password"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
