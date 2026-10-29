"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RotateCcw } from "lucide-react";

export default function DoctorWavesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DoctorWavesError] Route Error Boundary Caught:", error);
  }, [error]);

  return (
    <div className="container mx-auto max-w-2xl px-4 py-16 text-center space-y-4">
      <div className="flex justify-center">
        <div className="h-12 w-12 rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400 flex items-center justify-center">
          <AlertCircle className="h-6 w-6" />
        </div>
      </div>
      <h2 className="text-xl font-bold tracking-tight text-foreground">
        Failed to load wave scheduling
      </h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        An error occurred while loading your wave schedules. Please try again or check back later.
      </p>
      <div className="pt-2">
        <Button onClick={() => reset()} variant="default" size="sm" className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Try Again
        </Button>
      </div>
    </div>
  );
}
