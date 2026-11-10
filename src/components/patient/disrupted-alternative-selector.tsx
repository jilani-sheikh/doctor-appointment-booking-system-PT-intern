"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Stethoscope,
  ArrowRight,
  Ban,
} from "lucide-react";
import {
  formatDateIST,
  formatSlotRange,
  formatSlotDateTimeRangeIST,
} from "@/lib/time";
import {
  getVisibleAlternativeCategories,
  type AlternativeSlotSuggestion,
  type ThreeLevelAlternativeSuggestions,
} from "@/lib/scheduling";
import { patientRescheduleAppointmentAction } from "@/lib/actions/reschedule";

export interface DisruptedAlternativeSelectorProps {
  appointmentId: string;
  doctorName: string;
  specialization: string;
  originalSlotStart: string | Date;
  originalSlotEnd: string | Date;
  disruptionReason?: string | null;
  suggestedAlternatives?: ThreeLevelAlternativeSuggestions | null;
  onCancelClick?: () => void;
}

export function DisruptedAlternativeSelector({
  appointmentId,
  doctorName,
  specialization,
  originalSlotStart,
  originalSlotEnd,
  disruptionReason,
  suggestedAlternatives,
  onCancelClick,
}: DisruptedAlternativeSelectorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectingSlotId, setSelectingSlotId] = useState<string | null>(null);

  const visibleCategories = getVisibleAlternativeCategories(suggestedAlternatives);

  const handleSelectSlot = (slot: AlternativeSlotSuggestion) => {
    setSelectingSlotId(slot.id);
    startTransition(async () => {
      const res = await patientRescheduleAppointmentAction({
        appointmentId,
        newAvailabilityId: slot.id,
      });

      setSelectingSlotId(null);

      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(
          res.error ||
            "This slot is no longer available. Refreshing available alternatives..."
        );
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/70 dark:bg-amber-950/25 p-4 sm:p-5 space-y-4">
      {/* Header & Action Required Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-amber-200/80 dark:border-amber-800/60 pb-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-amber-600 hover:bg-amber-600 text-white border-transparent text-[10px] uppercase font-bold tracking-wide gap-1">
              <AlertTriangle className="h-3 w-3" />
              Action Required
            </Badge>
            <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              Doctor Availability Updated
            </span>
          </div>

          <p className="text-xs text-amber-900/90 dark:text-amber-200/90">
            Dr. {doctorName}&apos;s availability has changed
            {disruptionReason ? ` (${disruptionReason})` : ""}. Your original appointment remains protected until you select a new time below or the clinic resolves it.
          </p>

          <div className="flex items-center gap-1.5 text-xs text-amber-950 dark:text-amber-100 pt-0.5">
            <Clock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
            <span>
              Original Appointment:{" "}
              <strong>
                {formatSlotDateTimeRangeIST(originalSlotStart, originalSlotEnd)}
              </strong>{" "}
              with Dr. {doctorName} ({specialization})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Link
            href={`/book/reschedule/${appointmentId}`}
            className={buttonVariants({
              variant: "outline",
              size: "xs",
              className:
                "border-amber-400 dark:border-amber-700 bg-white/80 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100 hover:bg-amber-100/80 gap-1",
            })}
          >
            Full Calendar
            <ArrowRight className="h-3 w-3" />
          </Link>
          {onCancelClick && (
            <Button
              type="button"
              variant="destructive"
              size="xs"
              disabled={isPending}
              onClick={onCancelClick}
              className="gap-1"
            >
              <Ban className="h-3 w-3" />
              Cancel (100% Refund)
            </Button>
          )}
        </div>
      </div>

      {/* Choose an Alternative Appointment Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-primary" />
            Choose an Alternative Appointment
          </h4>
          <span className="text-[11px] text-muted-foreground">
            One-click rescheduling at no additional charge
          </span>
        </div>

        {visibleCategories.length === 0 ? (
          <div className="rounded-lg border border-amber-300/80 dark:border-amber-800 bg-white/80 dark:bg-card/70 p-3.5 text-xs text-amber-950 dark:text-amber-100 space-y-1">
            <p className="font-semibold">
              No Suitable Alternative Appointments Currently Available
            </p>
            <p className="text-muted-foreground">
              There are currently no open alternative slots available across same-day, upcoming dates, or other eligible doctors at the clinic. Please contact the clinic for assistance. Your original appointment remains protected.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleCategories.map((category) => (
              <div
                key={category.key}
                className="rounded-lg border border-border bg-card/95 p-3 space-y-2.5 shadow-2xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {category.priority}. {category.title}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {category.items.length}{" "}
                    {category.items.length === 1 ? "option" : "options"}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {category.items.map((slot) => {
                    const isThisSlotLoading =
                      isPending && selectingSlotId === slot.id;
                    const dateLabel = formatDateIST(slot.startTime, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    });
                    const timeRange = formatSlotRange(
                      slot.startTime,
                      slot.endTime
                    );
                    const seatsRemaining = Math.max(
                      0,
                      slot.capacity - slot.activeCount
                    );

                    return (
                      <div
                        key={slot.id}
                        className="rounded-lg border border-border bg-background p-3 flex flex-col justify-between gap-2.5 hover:border-primary/50 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                            <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="truncate">
                              Dr. {slot.doctorName}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {slot.specialization}
                          </p>
                          <div className="text-xs font-semibold text-foreground pt-0.5">
                            {dateLabel}
                          </div>
                          <div className="text-xs text-primary font-medium">
                            {timeRange}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {slot.kind === "STREAM_WINDOW"
                              ? `Stream Window · ${seatsRemaining} seat${seatsRemaining === 1 ? "" : "s"} left`
                              : `Wave Slot · ${seatsRemaining} seat${seatsRemaining === 1 ? "" : "s"} left`}
                          </div>
                        </div>

                        <Button
                          type="button"
                          size="xs"
                          variant="default"
                          disabled={isPending}
                          onClick={() => handleSelectSlot(slot)}
                          className="w-full gap-1.5 font-semibold"
                        >
                          {isThisSlotLoading ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Rescheduling...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Select This Slot
                            </>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

