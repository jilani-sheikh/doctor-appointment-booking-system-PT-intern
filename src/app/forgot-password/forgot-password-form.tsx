"use client";

import { useState, useTransition } from "react";
import { requestPasswordResetAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail } from "lucide-react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await requestPasswordResetAction({ email });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setMessage(result.message ?? "Please check your email for further instructions.");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot password?</CardTitle>
        <CardDescription>Enter your email and we will send password reset instructions if an account exists.</CardDescription>
      </CardHeader>
      <CardContent>
        {message ? (
          <p className="rounded-md bg-primary/10 p-3 text-sm text-foreground">{message}</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="forgot-email">Email</Label>
              <Input id="forgot-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={isPending}>
              <Mail className="h-4 w-4 mr-2" />
              {isPending ? "Sending..." : "Send reset link"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
