"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelPatientAppointmentAction } from "@/lib/actions/appointments";
import { cancelHoldAction, resumeHoldPaymentAction } from "@/lib/actions/payments";
import { patientCheckInAction } from "@/lib/actions/queue";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Calendar,
  Clock,
  Ban,
  UserCheck,
  AlertTriangle,
  RotateCcw,
  Activity,
  AlertCircle,
  Waves,
  CreditCard,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { formatTimeIST, formatSlotRange, formatSlotDateTimeRangeIST } from "@/lib/time";
import { STREAM_CONFIGS } from "@/lib/streams";
import { EMERGENCY_DISCLAIMER } from "@/lib/queue";
import type { AppointmentStatus } from "@/generated/prisma/client";
import type { SerializedPatientAppointment } from "@/lib/serializers";
export type { SerializedPatientAppointment };

interface AppointmentsViewProps {
  upcomingAppointments: SerializedPatientAppointment[];
  pastAppointments: SerializedPatientAppointment[];
}

export function AppointmentsView({
  upcomingAppointments,
  pastAppointments,
}: AppointmentsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Cancellation Modal State
  const [cancelModalAppt, setCancelModalAppt] = useState<SerializedPatientAppointment | null>(null);
  const [cancelModalTime, setCancelModalTime] = useState<number>(0);

  // Auto-refresh every 30 seconds while tab is active and visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [router]);

  const openCancelModal = (appt: SerializedPatientAppointment) => {
    setCancelModalAppt(appt);
    setCancelModalTime(Date.now());
  };

  const handleConfirmCancel = () => {
    if (!cancelModalAppt) return;
    const apptId = cancelModalAppt.id;

    startTransition(async () => {
      const res = await cancelPatientAppointmentAction(apptId);
      setCancelModalAppt(null);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error || "Failed to cancel appointment.");
      }
    });
  };

  const handleCancelHold = (appointmentId: string) => {
    startTransition(async () => {
      const res = await cancelHoldAction(appointmentId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error || "Failed to cancel hold.");
      }
    });
  };

  const handleResumePayment = async (appt: SerializedPatientAppointment) => {
    toast.loading("Preparing secure payment checkout...", { id: "checkout" });
    try {
      const res = await resumeHoldPaymentAction(appt.id);
      if (!res.success || !res.paymentSessionId) {
        toast.error(res.error || "Checkout session has expired. Please reserve an available slot.", { id: "checkout" });
        return;
      }

      const { load } = await import("@cashfreepayments/cashfree-js");
      const cashfree = await load({
        mode: process.env.NEXT_PUBLIC_CASHFREE_ENV === "production" ? "production" : "sandbox",
      });
      await cashfree.checkout({
        paymentSessionId: res.paymentSessionId,
        redirectTarget: "_self",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to launch payment checkout.";
      toast.error(message, { id: "checkout" });
    }
  };

  const handleCheckIn = (appointmentId: string) => {
    startTransition(async () => {
      const res = await patientCheckInAction(appointmentId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error);
      }
    });
  };

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case "PENDING_PAYMENT":
        return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px] uppercase font-semibold">Hold - Payment Pending</Badge>;
      case "PENDING":
        return <Badge variant="warning" className="text-[10px] uppercase font-semibold">Pending</Badge>;
      case "CONFIRMED":
        return <Badge variant="success" className="text-[10px] uppercase font-semibold">Confirmed</Badge>;
      case "CHECKED_IN":
        return <Badge variant="warning" className="text-[10px] uppercase bg-amber-600 text-white font-semibold">Checked In / Waiting</Badge>;
      case "IN_CONSULTATION":
        return <Badge variant="default" className="text-[10px] uppercase bg-blue-600 animate-pulse font-semibold">In Consultation</Badge>;
      case "COMPLETED":
        return <Badge variant="default" className="text-[10px] uppercase bg-emerald-600 font-semibold">Completed</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive" className="text-[10px] uppercase font-semibold">Cancelled</Badge>;
      case "NO_SHOW":
        return <Badge variant="destructive" className="text-[10px] uppercase bg-rose-700 font-semibold">No Show</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] uppercase">{status}</Badge>;
    }
  };

  const renderAppointmentList = (appointments: SerializedPatientAppointment[], isUpcomingTab: boolean) => {
    if (appointments.length === 0) {
      return (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/60 mb-3" />
            <h3 className="font-semibold text-base text-foreground mb-1">
              {isUpcomingTab ? "No upcoming consultations" : "No consultation history"}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mb-4">
              {isUpcomingTab
                ? "You don't have any active or upcoming medical appointments scheduled."
                : "Your past consultations, completed visits, and cancellations will appear here."}
            </p>
            {isUpcomingTab && (
              <Link href="/doctors" className={buttonVariants({ size: "sm" })}>
                Find a Doctor & Book
              </Link>
            )}
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {appointments.map((appt) => {
          const startDate = new Date(appt.slotStartTime);
          const endDate = new Date(appt.slotEndTime);
          const streamConfig = STREAM_CONFIGS[appt.stream];
          const isDisrupted = Boolean(appt.disruptedAt);
          const isPendingHold = appt.status === "PENDING_PAYMENT";

          return (
            <Card
              key={appt.id}
              className={`overflow-hidden transition-all duration-200 border ${
                isPendingHold
                  ? "border-amber-400 bg-amber-500/5 shadow-sm"
                  : isDisrupted
                  ? "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20"
                  : "hover:border-primary/40 shadow-sm"
              }`}
            >
              <CardContent className="p-4 sm:p-5 space-y-3">
                {/* Pending Payment Hold Notice */}
                {isPendingHold && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>
                        <strong>Provisional Hold Active:</strong> Reserved until{" "}
                        {appt.holdExpiresAt ? formatTimeIST(appt.holdExpiresAt) : "20 minutes"}{" "}
                        (IST). Complete payment to secure this slot.
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="xs"
                        className="bg-primary hover:bg-primary/90 text-white gap-1"
                        onClick={() => handleResumePayment(appt)}
                        disabled={isPending}
                      >
                        <CreditCard className="h-3 w-3" />
                        Complete Payment
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        className="border-amber-500/30 text-amber-900 dark:text-amber-200"
                        onClick={() => handleCancelHold(appt.id)}
                        disabled={isPending}
                      >
                        Cancel Hold
                      </Button>
                    </div>
                  </div>
                )}

                {/* Disruption Alert Banner */}
                {isDisrupted && (
                  <div className="rounded-md bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 p-3 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <div>
                        <strong className="font-semibold">Schedule Disrupted: </strong>
                        <span>{appt.disruptionReason ?? "Schedule disruption"}. Please reschedule or cancel with 100% refund.</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/book/reschedule/${appt.id}`}
                        className={buttonVariants({ size: "xs", variant: "default", className: "bg-amber-600 hover:bg-amber-700 text-white" })}
                      >
                        Reschedule
                      </Link>
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={isPending}
                        onClick={() => openCancelModal(appt)}
                      >
                        Cancel Consultation
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-foreground">
                        Dr. {appt.doctor.name}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {appt.doctor.specialization}
                      </Badge>
                      <span className={`inline-flex items-center text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${streamConfig.badgeClassName}`}>
                        {streamConfig.label}
                      </span>
                      {getStatusBadge(appt.status)}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        {formatSlotDateTimeRangeIST(startDate, endDate)}
                      </span>
                      <span>•</span>
                      <span>Fee: ₹{appt.doctor.consultationFee.toLocaleString("en-IN")}</span>
                    </div>

                    {appt.arrivalWindow && (
                      <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 p-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                        <Waves className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>
                          Arrive between <strong>{appt.arrivalWindow.replace(" (IST)", "")} (IST)</strong>. Your consultation slot is <strong>{formatSlotRange(startDate, endDate)}</strong>.
                        </span>
                      </div>
                    )}

                    {/* Live Queue Estimate details */}
                    {appt.queuePosition !== null && appt.queuePosition !== undefined && (
                      <div className="flex items-center gap-3 text-xs bg-muted/40 p-2.5 rounded-md border border-border/50 flex-wrap">
                        <span className="flex items-center gap-1 font-semibold text-foreground">
                          <Activity className="h-3.5 w-3.5 text-blue-600" />
                          Queue Position: #{appt.queuePosition}
                        </span>
                        {appt.estimatedStart && (
                          <>
                            <span>•</span>
                            <span>
                              Estimated Consultation: <strong>{formatTimeIST(appt.estimatedStart)}</strong>
                            </span>
                          </>
                        )}
                        {appt.estimatedDelayMinutes && appt.estimatedDelayMinutes > 0 ? (
                          <span className="text-rose-600 font-semibold">
                            (approx. {appt.estimatedDelayMinutes} min delay)
                          </span>
                        ) : null}
                      </div>
                    )}

                    {appt.reason && (
                      <p className="text-xs text-muted-foreground bg-muted/20 p-2 rounded-md border border-border/40 max-w-2xl">
                        <strong className="text-foreground font-semibold">Reason: </strong>
                        {appt.reason}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border flex-wrap">
                    {/* Self Check-In Button */}
                    {isUpcomingTab && appt.canCheckIn && (
                      <Button
                        variant="default"
                        size="xs"
                        disabled={isPending}
                        onClick={() => handleCheckIn(appt.id)}
                        className="gap-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Self Check-In
                      </Button>
                    )}

                    {/* Reschedule Button */}
                    {isUpcomingTab && appt.canReschedule && !isDisrupted && !isPendingHold && (
                      <Link
                        href={`/book/reschedule/${appt.id}`}
                        className={buttonVariants({ variant: "outline", size: "xs", className: "gap-1" })}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reschedule
                      </Link>
                    )}

                    <Link
                      href={`/doctors/${appt.doctor.id}`}
                      className={buttonVariants({ variant: "ghost", size: "xs" })}
                    >
                      Doctor Profile
                    </Link>

                    {isUpcomingTab && appt.canCancel && !isDisrupted && !isPendingHold && (
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={isPending}
                        onClick={() => openCancelModal(appt)}
                        className="gap-1"
                      >
                        <Ban className="h-3 w-3" />
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  // Compute refund preview for cancellation modal
  let refundPreviewText = "No payment was recorded for this appointment.";
  if (cancelModalAppt) {
    const fee = cancelModalAppt.doctor.consultationFee;
    const now = cancelModalTime || new Date(cancelModalAppt.slotStartTime).getTime();
    const diffHours = (new Date(cancelModalAppt.slotStartTime).getTime() - now) / (1000 * 60 * 60);

    if (cancelModalAppt.disruptedAt) {
      refundPreviewText = `Full refund of ₹${fee.toLocaleString("en-IN")} (100%) due to schedule disruption.`;
    } else if (fee > 0) {
      if (diffHours >= 24) {
        refundPreviewText = `You will be refunded ₹${fee.toLocaleString("en-IN")} (100% refund for cancelling >= 24h prior).`;
      } else if (diffHours >= 2) {
        const halfFee = Math.round(fee / 2);
        refundPreviewText = `You will be refunded ₹${halfFee.toLocaleString("en-IN")} (50% refund for cancelling between 2h and 24h prior).`;
      } else {
        refundPreviewText = "No refund is applicable for cancellations within 2 hours of consultation.";
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Static Emergency Notice */}
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-primary shrink-0" />
        <span>{EMERGENCY_DISCLAIMER}</span>
      </div>

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
          <TabsTrigger value="upcoming">
            Upcoming ({upcomingAppointments.length})
          </TabsTrigger>
          <TabsTrigger value="past">
            Past & History ({pastAppointments.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          {renderAppointmentList(upcomingAppointments, true)}
        </TabsContent>

        <TabsContent value="past">
          {renderAppointmentList(pastAppointments, false)}
        </TabsContent>
      </Tabs>

      {/* Cancellation Confirmation Dialog with Refund Policy Breakdown */}
      <Dialog open={Boolean(cancelModalAppt)} onOpenChange={(open) => !open && setCancelModalAppt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              Cancel Consultation
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your consultation with Dr. {cancelModalAppt?.doctor.name}?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3 text-sm">
            <div className="rounded-lg bg-muted/50 p-3 border border-border/60 space-y-1.5 text-xs">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span>Refund Policy Assessment</span>
              </div>
              <p className="text-foreground font-medium">{refundPreviewText}</p>
              <p className="text-muted-foreground">
                Refunds are processed to your original payment method and typically reflect within 3 to 7 business days.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setCancelModalAppt(null)}
            >
              Keep Appointment
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={handleConfirmCancel}
              className="gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                "Confirm Cancellation"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
