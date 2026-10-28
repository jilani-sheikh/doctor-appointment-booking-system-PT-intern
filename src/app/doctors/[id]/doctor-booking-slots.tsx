"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookAppointmentAction } from "@/lib/actions/appointments";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Calendar, Clock, Loader2, Stethoscope, CheckCircle2 } from "lucide-react";
import { formatTimeIST } from "@/lib/time";
import type { Role } from "@/generated/prisma/client";
import type { SerializedPublicSlot } from "@/lib/serializers";
export type { SerializedPublicSlot };

interface DoctorBookingSlotsProps {
  doctorId: string;
  doctorName: string;
  specialization: string;
  consultationFee: number;
  slotsGrouped: Record<string, SerializedPublicSlot[]>;
  currentUserRole: Role | null;
  isAuthenticated: boolean;
}

export function DoctorBookingSlots({
  doctorId,
  doctorName,
  specialization,
  consultationFee,
  slotsGrouped,
  currentUserRole,
  isAuthenticated,
}: DoctorBookingSlotsProps) {
  const router = useRouter();
  const [selectedSlot, setSelectedSlot] = useState<SerializedPublicSlot | null>(null);
  const [slotDateLabel, setSlotDateLabel] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSlotClick = (dateLabel: string, slot: SerializedPublicSlot) => {
    if (!isAuthenticated) {
      // Redirect to sign in with callback
      router.push(`/sign-in?callbackUrl=/doctors/${doctorId}`);
      return;
    }

    if (currentUserRole !== "PATIENT") {
      toast.error(
        `Only patients can book appointments. You are currently logged in as ${currentUserRole ?? "a non-patient role"}.`
      );
      return;
    }

    setSelectedSlot(slot);
    setSlotDateLabel(dateLabel);
    setReason("");
    setIsDialogOpen(true);
  };

  const handleConfirmBooking = () => {
    if (!selectedSlot) return;

    startTransition(async () => {
      const res = await bookAppointmentAction({
        availabilityId: selectedSlot.id,
        reason: reason.trim() || undefined,
      });

      if (res.success) {
        setIsDialogOpen(false);
        toast.success(res.message);
        router.push("/patient/appointments");
      } else {
        toast.error(res.error || "Failed to book appointment.");
      }
    });
  };

  const dates = Object.keys(slotsGrouped);

  if (dates.length === 0) {
    return (
      <Card className="border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <Calendar className="h-10 w-10 mb-3 opacity-40 text-primary" />
          <h3 className="font-semibold text-foreground text-base">No Open Slots in the Next 14 Days</h3>
          <p className="text-sm mt-1 max-w-sm">
            Dr. {doctorName} currently does not have open appointment slots available for booking. Please check back later.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Available Consultation Slots
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Times displayed in Indian Standard Time (IST). Select a slot to reserve your consultation.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {dates.map((dateKey) => {
          const slots = slotsGrouped[dateKey];
          return (
            <Card key={dateKey} className="overflow-hidden border-border shadow-xs">
              <CardHeader className="bg-muted/30 py-2.5 px-4 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    {dateKey}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-medium">
                    {slots.length} available
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-3.5 sm:p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
                  {slots.map((slot) => {
                    const startStr = formatTimeIST(new Date(slot.startTime));
                    const endStr = formatTimeIST(new Date(slot.endTime));

                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => handleSlotClick(dateKey, slot)}
                        className="p-2.5 rounded-lg border border-border bg-card hover:border-primary hover:bg-primary/5 hover:shadow-xs transition-all text-left flex flex-col justify-between group cursor-pointer"
                      >
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                          {startStr}
                        </span>
                        <span className="text-[11px] text-muted-foreground mt-0.5">
                          to {endStr}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Booking Confirmation Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Stethoscope className="h-5 w-5 text-primary" />
              Confirm Appointment
            </DialogTitle>
            <DialogDescription>
              Review your consultation booking with Dr. {doctorName}.
            </DialogDescription>
          </DialogHeader>

          {selectedSlot && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted/40 p-3.5 border border-border space-y-2 text-xs sm:text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Practitioner:</span>
                  <span className="font-semibold text-foreground">Dr. {doctorName} ({specialization})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date:</span>
                  <span className="font-medium text-foreground">{slotDateLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time (IST):</span>
                  <span className="font-medium text-foreground">
                    {formatTimeIST(new Date(selectedSlot.startTime))} - {formatTimeIST(new Date(selectedSlot.endTime))}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border/60 pt-2 font-semibold">
                  <span>Consultation Fee:</span>
                  <span className="text-primary text-base">₹{consultationFee.toLocaleString("en-IN")}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason" className="text-xs font-medium">
                  Reason for Consultation <span className="text-muted-foreground font-normal">(optional, max 500 chars)</span>
                </Label>
                <Textarea
                  id="reason"
                  placeholder="Describe symptoms, primary health concern, or previous medical history..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 500))}
                  maxLength={500}
                  className="resize-none h-20 text-xs sm:text-sm"
                />
                <span className="text-[11px] text-muted-foreground block text-right">
                  {reason.length}/500
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={handleConfirmBooking}
              className="gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Lock In Booking
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
