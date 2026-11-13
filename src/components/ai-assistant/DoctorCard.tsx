"use client";

import { CalendarClock, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DoctorCardData } from "@/lib/ai/schemas";

interface DoctorCardListProps {
  title: string;
  items: DoctorCardData[];
  disabled?: boolean;
  onSelectDoctor: (doctor: DoctorCardData) => void;
}

export function DoctorCardList({
  title,
  items,
  disabled,
  onSelectDoctor,
}: DoctorCardListProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        <span className="text-[11px] font-medium text-muted-foreground">
          {items.length} found
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">
          No approved doctors matched that search.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((doc) => (
            <div
              key={doc.id}
              className="rounded-lg border border-border/80 bg-background/60 p-2.5 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Stethoscope className="size-3.5 text-primary shrink-0" />
                    <span className="truncate">Dr. {doc.name}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {doc.specialization} • {doc.qualification} • {doc.experienceYears} yrs exp
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {doc.consultationFeeRupees > 0
                    ? `₹${doc.consultationFeeRupees}`
                    : "Free"}
                </span>
              </div>

              {doc.nextAvailableDateIST && doc.nextAvailableTimeIST ? (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                  <CalendarClock className="size-3 shrink-0" />
                  Next open: {doc.nextAvailableDateIST}, {doc.nextAvailableTimeIST}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No upcoming slots published right now.
                </p>
              )}

              <div className="pt-0.5">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onSelectDoctor(doc)}
                >
                  View Available Slots
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

