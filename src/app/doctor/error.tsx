"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function DoctorDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Doctor Dashboard Error]:", error);
  }, [error]);

  return (
    <div className="container mx-auto max-w-lg px-4 py-16 text-center space-y-4">
      <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive mx-auto flex items-center justify-center">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-foreground">Doctor Portal Error</h2>
      <p className="text-sm text-muted-foreground">
        An error occurred while loading your schedule or consultation appointments.
      </p>
      <div className="pt-2">
        <Button onClick={() => reset()} size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Try Again
        </Button>
      </div>
    </div>
  );
}
