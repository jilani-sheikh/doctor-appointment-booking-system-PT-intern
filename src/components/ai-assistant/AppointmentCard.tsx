"use client";

import { AlertTriangle, Calendar, Clock, CreditCard, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppointmentCardData } from "@/lib/ai/schemas";

interface AppointmentCardProps {
  title: string;
  viewerRole: "PATIENT" | "DOCTOR";
  items: AppointmentCardData[];
  disabled?: boolean;
  onQuickPrompt: (prompt: string) => void;
}

function getStatusClasses(status: string): string {
  switch (status) {
    case "CONFIRMED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";
    case "CHECKED_IN":
    case "IN_CONSULTATION":
      return "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800";
    case "PENDING_PAYMENT":
      return "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800";
    case "COMPLETED":
      return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    case "CANCELLED":
    case "NO_SHOW":
      return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function AppointmentCardList({
  title,
  viewerRole,
  items,
  disabled,
  onQuickPrompt,
}: AppointmentCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        <span className="text-[11px] font-medium text-muted-foreground">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">
          No matching appointments found.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((appt) => {
            const isDisrupted =
              Boolean(appt.disruptedAt) &&
              appt.rescheduleStatus === "PENDING_RESCHEDULING";

            return (
              <div
                key={appt.id}
                className="rounded-lg border border-border/80 bg-background/60 p-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {viewerRole === "PATIENT"
                        ? `Dr. ${appt.doctorName}`
                        : appt.patientName}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {viewerRole === "PATIENT"
                        ? appt.doctorSpecialization
                        : `Slot: ${appt.slotKind}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getStatusClasses(appt.status)}`}
                  >
                    {appt.status.replaceAll("_", " ")}
                  </span>
                </div>

                {isDisrupted && (
                  <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                    <span>
                      Availability changed — reschedule needed.
                      {appt.disruptionReason ? ` (${appt.disruptionReason})` : ""}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="size-3" />
                    {appt.dateIST}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" />
                    {appt.timeRangeIST}
                  </span>
                  {appt.tokenNumber ? (
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <Hash className="size-3" />
                      Token #{appt.tokenNumber}
                      {appt.waveLabel ? ` (${appt.waveLabel})` : ""}
                    </span>
                  ) : null}
                  {appt.amountDisplay ? (
                    <span className="inline-flex items-center gap-1">
                      <CreditCard className="size-3" />
                      {appt.amountDisplay}
                      {appt.paymentStatus ? ` • ${appt.paymentStatus}` : ""}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {viewerRole === "PATIENT" ? (
                    <>
                      {appt.requiresPaymentResume && (
                        <Button
                          type="button"
                          size="xs"
                          disabled={disabled}
                          onClick={() =>
                            onQuickPrompt(
                              `Prepare Cashfree payment checkout for appointmentId ${appt.id}.`
                            )
                          }
                        >
                          Pay Now
                        </Button>
                      )}
                      {appt.canCheckIn && (
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() =>
                            onQuickPrompt(
                              `Prepare check-in for appointmentId ${appt.id}.`
                            )
                          }
                        >
                          Check In
                        </Button>
                      )}
                      {(isDisrupted || appt.canReschedule) && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={disabled}
                          onClick={() =>
                            onQuickPrompt(
                              `Suggest alternative slots for appointmentId ${appt.id}.`
                            )
                          }
                        >
                          Reschedule
                        </Button>
                      )}
                      {appt.canCancel && (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={disabled}
                          onClick={() =>
                            onQuickPrompt(
                              `Prepare cancellation with refund preview for appointmentId ${appt.id}.`
                            )
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      {appt.canDoctorComplete && (
                        <Button
                          type="button"
                          size="xs"
                          disabled={disabled}
                          onClick={() =>
                            onQuickPrompt(
                              `Prepare marking appointmentId ${appt.id} as COMPLETED.`
                            )
                          }
                        >
                          Complete
                        </Button>
                      )}
                      {isDisrupted && (
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() =>
                            onQuickPrompt(
                              `Suggest reschedule slots for patient appointmentId ${appt.id}.`
                            )
                          }
                        >
                          Suggest Slots
                        </Button>
                      )}
                      {appt.canDoctorNoShow && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={disabled}
                          onClick={() =>
                            onQuickPrompt(
                              `Prepare marking appointmentId ${appt.id} as NO_SHOW.`
                            )
                          }
                        >
                          No-Show
                        </Button>
                      )}
                      {appt.canDoctorCancel && (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={disabled}
                          onClick={() =>
                            onQuickPrompt(
                              `Prepare cancelling patient appointmentId ${appt.id}.`
                            )
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

