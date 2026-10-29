"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Calendar, Clock, RotateCcw, AlertTriangle } from "lucide-react";
import { formatTimeIST, formatDateTimeIST } from "@/lib/time";
import { patientRescheduleAppointmentAction } from "@/lib/actions/reschedule";
import type { SerializedPublicSlot } from "@/lib/serializers";

interface RescheduleViewProps {
  appointmentId: string;
  doctorName: string;
  specialization: string;
  currentSlotStart: string;
  currentSlotEnd: string;
  rescheduleCount: number;
  maxRescheduleCount: number;
  isDisrupted: boolean;
  disruptionReason?: string | null;
  slotsGrouped: Record<string, SerializedPublicSlot[]>;
}

export function RescheduleView({
  appointmentId,
  doctorName,
  specialization,
  currentSlotStart,
  currentSlotEnd,
  rescheduleCount,
  maxRescheduleCount,
  isDisrupted,
  disruptionReason,
  slotsGrouped,
}: RescheduleViewProps) {
  const router = useRouter();
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedSlotTimeStr, setSelectedSlotTimeStr] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleConfirmReschedule = () => {
    if (!selectedSlotId) {
      toast.error("Please select a new consultation slot.");
      return;
    }

    startTransition(async () => {
      const res = await patientRescheduleAppointmentAction({
        appointmentId,
        newAvailabilityId: selectedSlotId,
      });

      if (res.success) {
        toast.success(res.message);
        router.push("/patient/appointments");
      } else {
        toast.error(res.error);
      }
    });
  };

  const dates = Object.keys(slotsGrouped);

  return (
    <div className="space-y-6">
      {/* Current Appointment Summary */}
      <Card className="border-border shadow-xs bg-muted/20">
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-xs text-muted-foreground">Rescheduling Consultation with</span>
              <h3 className="font-bold text-base text-foreground">Dr. {doctorName} ({specialization})</h3>
            </div>
            <Badge variant="outline" className="text-xs">
              Reschedules used: {rescheduleCount} / {maxRescheduleCount}
            </Badge>
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-primary" />
            Currently scheduled:{" "}
            <strong className="text-foreground ml-1">
              {formatDateTimeIST(currentSlotStart)} — {formatTimeIST(currentSlotEnd)}
            </strong>
          </div>

          {isDisrupted && (
            <div className="p-2.5 rounded-md bg-amber-100/70 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-100 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>
                <strong>Doctor Unavailable: </strong>
                {disruptionReason ?? "Schedule disruption"}. You may pick any upcoming available slot below.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Slots Picker */}
      <div className="space-y-4">
        <h3 className="font-bold text-base text-foreground flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          Select a New Consultation Slot
        </h3>

        {dates.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Calendar className="h-8 w-8 mb-2 opacity-40 text-primary" />
              <h4 className="font-semibold text-foreground text-sm">No Open Slots Available</h4>
              <p className="text-xs mt-1 max-w-sm">
                Dr. {doctorName} does not currently have any other open slots in the next 14 days.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {dates.map((dateLabel) => {
              const daySlots = slotsGrouped[dateLabel];

              return (
                <Card key={dateLabel} className="border-border shadow-xs">
                  <CardHeader className="py-3 px-4 bg-muted/40 border-b border-border">
                    <CardTitle className="text-xs font-semibold text-foreground">
                      {dateLabel}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {daySlots.map((slot) => {
                        const isSelected = selectedSlotId === slot.id;
                        const timeRange = `${formatTimeIST(slot.startTime)} - ${formatTimeIST(slot.endTime)}`;

                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => {
                              setSelectedSlotId(slot.id);
                              setSelectedSlotTimeStr(`${dateLabel}, ${timeRange}`);
                            }}
                            className={`p-2.5 rounded-lg border text-xs font-medium transition-all text-center ${
                              isSelected
                                ? "bg-primary text-primary-foreground border-primary shadow-xs font-bold ring-2 ring-primary/30"
                                : "bg-card text-foreground border-border hover:border-primary/50 hover:bg-muted/30"
                            }`}
                          >
                            {formatTimeIST(slot.startTime)}
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Bar */}
      {selectedSlotId && (
        <div className="sticky bottom-4 z-20 p-4 rounded-xl border border-primary/30 bg-card/95 backdrop-blur-md shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-xs text-muted-foreground">New consultation time selected:</span>
            <div className="font-bold text-sm text-foreground">{selectedSlotTimeStr}</div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedSlotId(null)}
              className="text-xs"
            >
              Cancel Selection
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={isPending}
              onClick={handleConfirmReschedule}
              className="text-xs bg-primary hover:bg-primary/90 font-semibold gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {isPending ? "Rescheduling..." : "Confirm Reschedule"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
