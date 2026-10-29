"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookAppointmentAction } from "@/lib/actions/appointments";
import { joinWaitlistAction, leaveWaitlistAction } from "@/lib/actions/reschedule";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Calendar, Loader2, Stethoscope, CheckCircle2, BellRing, BellOff } from "lucide-react";
import { formatTimeIST } from "@/lib/time";
import type { Role } from "@/generated/prisma/enums";
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
  isWaitlisted?: boolean;
}

export function DoctorBookingSlots({
  doctorId,
  doctorName,
  specialization,
  consultationFee,
  slotsGrouped,
  currentUserRole,
  isAuthenticated,
  isWaitlisted = false,
}: DoctorBookingSlotsProps) {
  const router = useRouter();
  const [selectedSlot, setSelectedSlot] = useState<SerializedPublicSlot | null>(null);
  const [slotDateLabel, setSlotDateLabel] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [stream, setStream] = useState<"NEW_CONSULTATION" | "FOLLOW_UP">("NEW_CONSULTATION");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  // Waitlist modal state
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const [waitlistStart, setWaitlistStart] = useState("");
  const [waitlistEnd, setWaitlistEnd] = useState("");

  const handleSlotClick = (dateLabel: string, slot: SerializedPublicSlot) => {
    if (!isAuthenticated) {
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
    setStream("NEW_CONSULTATION");
    setReason("");
    setIsDialogOpen(true);
  };

  const handleConfirmBooking = () => {
    if (!selectedSlot) return;

    startTransition(async () => {
      const res = await bookAppointmentAction({
        availabilityId: selectedSlot.id,
        stream,
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

  const handleJoinWaitlist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      router.push(`/sign-in?callbackUrl=/doctors/${doctorId}`);
      return;
    }

    if (currentUserRole !== "PATIENT") {
      toast.error("Only registered patients can join practitioner waitlists.");
      return;
    }

    if (!waitlistStart || !waitlistEnd) {
      toast.error("Please pick both earliest and latest dates.");
      return;
    }

    startTransition(async () => {
      const res = await joinWaitlistAction({
        doctorId,
        earliestDate: new Date(`${waitlistStart}T00:00:00Z`).toISOString(),
        latestDate: new Date(`${waitlistEnd}T23:59:59Z`).toISOString(),
      });

      if (res.success) {
        toast.success(res.message);
        setIsWaitlistOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleLeaveWaitlist = () => {
    startTransition(async () => {
      const res = await leaveWaitlistAction(doctorId);
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const dates = Object.keys(slotsGrouped);

  if (dates.length === 0) {
    return (
      <Card className="border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-4">
          <Calendar className="h-10 w-10 opacity-40 text-primary" />
          <div className="space-y-1">
            <h3 className="font-semibold text-foreground text-base">No Open Slots in the Next 14 Days</h3>
            <p className="text-sm max-w-sm">
              Dr. {doctorName} currently does not have open appointment slots available for booking.
            </p>
          </div>

          <div className="pt-2">
            {isWaitlisted ? (
              <div className="flex items-center gap-3">
                <Badge variant="success" className="gap-1.5 py-1 px-3 text-xs">
                  <BellRing className="h-3.5 w-3.5" />
                  You are on the Waitlist
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={handleLeaveWaitlist}
                  className="text-xs text-destructive hover:bg-destructive/10"
                >
                  <BellOff className="h-3.5 w-3.5 mr-1" />
                  Leave Waitlist
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsWaitlistOpen(true)}
                className="gap-2 text-xs"
              >
                <BellRing className="h-3.5 w-3.5 text-primary" />
                Join Waitlist for Newly Available Slots
              </Button>
            )}
          </div>

          {/* Waitlist Dialog */}
          <Dialog open={isWaitlistOpen} onOpenChange={setIsWaitlistOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-primary" />
                  Join Dr. {doctorName}&apos;s Waitlist
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Whenever a slot returns to available (via cancellation or reschedule), you will receive an immediate in-app notification.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleJoinWaitlist} className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Earliest Acceptable Date</Label>
                  <Input
                    type="date"
                    value={waitlistStart}
                    onChange={(e) => setWaitlistStart(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Latest Acceptable Date</Label>
                  <Input
                    type="date"
                    value={waitlistEnd}
                    onChange={(e) => setWaitlistEnd(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsWaitlistOpen(false)}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={isPending} className="text-xs">
                    {isPending ? "Joining..." : "Join Waitlist"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
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
        {dates.map((dateLabel) => {
          const daySlots = slotsGrouped[dateLabel];

          return (
            <Card key={dateLabel} className="border-border shadow-xs">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b border-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    {dateLabel}
                  </span>
                  <Badge variant="outline" className="text-[10px] uppercase font-medium">
                    {daySlots.length} open {daySlots.length === 1 ? "slot" : "slots"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {daySlots.map((slot) => {
                    const startUtc = new Date(slot.startTime);

                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => handleSlotClick(dateLabel, slot)}
                        className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-border/80 bg-card hover:bg-primary/5 hover:border-primary/50 transition-all text-xs font-medium text-foreground cursor-pointer group shadow-2xs hover:shadow-xs"
                      >
                        <span className="group-hover:text-primary font-semibold">
                          {formatTimeIST(startUtc)}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-primary" />
              Confirm Consultation Booking
            </DialogTitle>
            <DialogDescription className="text-xs">
              Please review the consultation details and select your consultation type.
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

              {/* Visit Stream Picker (Promt5.md Section 4) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Visit Consultation Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStream("NEW_CONSULTATION")}
                    className={`p-3 rounded-lg border text-xs text-left transition-all ${
                      stream === "NEW_CONSULTATION"
                        ? "border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary/40"
                        : "border-border text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <div>New Consultation</div>
                    <span className="text-[10px] font-normal text-muted-foreground">First-time condition</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStream("FOLLOW_UP")}
                    className={`p-3 rounded-lg border text-xs text-left transition-all ${
                      stream === "FOLLOW_UP"
                        ? "border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary/40"
                        : "border-border text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <div>Follow-Up</div>
                    <span className="text-[10px] font-normal text-muted-foreground">Ongoing care or review</span>
                  </button>
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
