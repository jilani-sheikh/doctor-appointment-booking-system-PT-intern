"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Clock, AlertCircle } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

interface PendingRefreshProps {
  orderId: string;
}

export function PendingRefresh({ orderId }: PendingRefreshProps) {
  const router = useRouter();
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (timedOut) return;

    const interval = setInterval(() => {
      setSecondsElapsed((prev) => {
        const next = prev + 5;
        if (next >= 60) {
          setTimedOut(true);
          clearInterval(interval);
          return 60;
        }
        router.refresh();
        return next;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [router, timedOut]);

  return (
    <div className="container max-w-lg mx-auto py-16 px-4">
      <div className="bg-card border border-border/80 rounded-2xl p-8 shadow-sm text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto mb-6">
          <Clock className="h-10 w-10 animate-pulse" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Confirming Payment...</h1>
        <p className="text-muted-foreground text-sm mb-6">
          We are confirming your transaction with Cashfree and your bank.
        </p>

        {!timedOut ? (
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground mb-8 bg-muted/50 px-3 py-1.5 rounded-full border border-border/50">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>Checking gateway status... ({secondsElapsed}s / 60s)</span>
          </div>
        ) : (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-900 dark:text-amber-200 text-left mb-8 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Verification taking longer than usual</p>
              <p>
                If money was deducted from your account, your consultation will confirm automatically once verified by your bank. Order ID: <span className="font-mono">{orderId}</span>
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => {
              setTimedOut(false);
              setSecondsElapsed(0);
              router.refresh();
            }}
            type="button"
            className={buttonVariants({ variant: "outline", className: "gap-2" })}
          >
            <RefreshCw className="h-4 w-4" />
            Check Status Now
          </button>
          <Link href="/patient/appointments" className={buttonVariants()}>
            Go to Appointments
          </Link>
        </div>
      </div>
    </div>
  );
}
