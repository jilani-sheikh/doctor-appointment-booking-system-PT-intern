"use client";

import { Calendar, Clock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SlotOptionData } from "@/lib/ai/schemas";

interface SlotSelectorProps {
  title: string;
  mode: "BOOK" | "PATIENT_RESCHEDULE" | "DOCTOR_RESCHEDULE";
  appointmentId?: string;
  slots: SlotOptionData[];
  disabled?: boolean;
  onSelectSlot: (
    slot: SlotOptionData,
    mode: "BOOK" | "PATIENT_RESCHEDULE" | "DOCTOR_RESCHEDULE",
    appointmentId?: string
  ) => void;
}

export function SlotSelector({
  title,
  mode,
  appointmentId,
  slots,
  disabled,
  onSelectSlot,
}: SlotSelectorProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        <span className="text-[11px] font-medium text-muted-foreground">
          {slots.length} slot{slots.length === 1 ? "" : "s"}
        </span>
      </div>

      {slots.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">
          No open slots available matching this request.
        </p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
          {slots.map((slot) => (
            <div
              key={`${slot.availabilityId}-${slot.categoryLabel ?? "slot"}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-background/60 p-2"
            >
              <div className="min-w-0 space-y-0.5">
                {slot.categoryLabel && (
                  <span className="inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {slot.categoryLabel}
                  </span>
                )}
                <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Calendar className="size-3 text-muted-foreground shrink-0" />
                  <span>{slot.dateIST}</span>
                </p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Clock className="size-3 shrink-0" />
                  <span>{slot.timeRangeIST}</span>
                  <span>•</span>
                  <Users className="size-3 shrink-0" />
                  <span>{slot.remainingSeats} left</span>
                </p>
                {slot.doctorName && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    Dr. {slot.doctorName}
                    {slot.consultationFeeRupees > 0
                      ? ` • ₹${slot.consultationFeeRupees}`
                      : " • Free"}
                  </p>
                )}
              </div>

              <Button
                type="button"
                size="xs"
                className="shrink-0"
                disabled={disabled}
                onClick={() => onSelectSlot(slot, mode, appointmentId)}
              >
                Select This Slot
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

