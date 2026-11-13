"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ConfirmResponsePayload, PendingConfirmation } from "@/lib/ai/schemas";

interface ActionConfirmationProps {
  confirmation: PendingConfirmation;
  onSettled?: (outcome: {
    confirmationId: string;
    status: "confirmed" | "cancelled" | "failed";
    message: string;
  }) => void;
}

export function ActionConfirmation({
  confirmation,
  onSettled,
}: ActionConfirmationProps) {
  const router = useRouter();
  const [state, setState] = useState<
    "pending" | "submitting" | "confirmed" | "cancelled" | "failed" | "expired"
  >(() => confirmation.settledStatus ?? "pending");
  const [statusMessage, setStatusMessage] = useState<string | null>(
    () => confirmation.settledMessage ?? null
  );

  async function handleConfirm() {
    if (state !== "pending") return;
    setState("submitting");
    setStatusMessage(null);

    try {
      const res = await fetch("/api/ai-assistant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: confirmation.token }),
      });

      const data = (await res.json()) as ConfirmResponsePayload;
      if (!res.ok || !data.success) {
        const msg = data.error || data.message || "Could not confirm this action.";
        setState("failed");
        setStatusMessage(msg);
        toast.error(msg);
        onSettled?.({
          confirmationId: confirmation.confirmationId,
          status: "failed",
          message: msg,
        });
        return;
      }

      setState("confirmed");
      setStatusMessage(data.message);
      toast.success(data.message);
      router.refresh();
      onSettled?.({
        confirmationId: confirmation.confirmationId,
        status: "confirmed",
        message: data.message,
      });

      if (data.requiresPayment && data.paymentSessionId) {
        try {
          const { load } = await import("@cashfreepayments/cashfree-js");
          const cashfree = await load({
            mode:
              process.env.NEXT_PUBLIC_CASHFREE_ENV === "production"
                ? "production"
                : "sandbox",
          });
          await cashfree.checkout({
            paymentSessionId: data.paymentSessionId,
            redirectTarget: "_self",
          });
        } catch (checkoutErr) {
          console.error("Cashfree checkout launch failed:", checkoutErr);
          toast.error(
            "Hold created, but checkout failed to open. Complete payment from your Appointments page."
          );
        }
      }
    } catch {
      const msg = "Network error while confirming action. Please try again.";
      setState("failed");
      setStatusMessage(msg);
      toast.error(msg);
    }
  }

  function handleDismiss() {
    if (state !== "pending") return;
    setState("cancelled");
    const msg = "Action cancelled. No changes were made.";
    setStatusMessage(msg);
    onSettled?.({
      confirmationId: confirmation.confirmationId,
      status: "cancelled",
      message: msg,
    });
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-3 shadow-xs space-y-2.5">
      <div className="flex items-start gap-2">
        <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-foreground">
            {confirmation.title}
          </h4>
          <p className="text-[11px] text-muted-foreground">{confirmation.summary}</p>
        </div>
      </div>

      {confirmation.details.length > 0 && (
        <dl className="rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2 space-y-1">
          {confirmation.details.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-3 text-[11px]">
              <dt className="text-muted-foreground shrink-0">{row.label}</dt>
              <dd className="text-foreground font-medium text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {confirmation.warning && (
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <span>{confirmation.warning}</span>
        </div>
      )}

      {statusMessage && (
        <div
          className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] ${
            state === "confirmed"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              : state === "failed"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-muted text-muted-foreground"
          }`}
        >
          {state === "confirmed" ? (
            <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="size-3.5 shrink-0 mt-0.5" />
          )}
          <span>{statusMessage}</span>
        </div>
      )}

      {state === "pending" || state === "submitting" ? (
        <div className="flex items-center justify-end gap-2 pt-0.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={state === "submitting"}
            onClick={handleDismiss}
          >
            {confirmation.cancelLabel}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={state === "submitting"}
            onClick={handleConfirm}
          >
            {state === "submitting" && (
              <Loader2 className="size-3 animate-spin mr-1" />
            )}
            {confirmation.confirmLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

