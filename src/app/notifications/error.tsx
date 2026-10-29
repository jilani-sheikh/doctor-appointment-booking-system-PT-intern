"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotificationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[NotificationsError]", error);
  }, [error]);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-16 text-center space-y-4">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-foreground">Failed to load notifications</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        An error occurred while loading your notifications. Please try again.
      </p>
      <div>
        <Button onClick={() => reset()} variant="outline">
          Try again
        </Button>
      </div>
    </div>
  );
}
