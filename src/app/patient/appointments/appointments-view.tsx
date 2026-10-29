"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelPatientAppointmentAction } from "@/lib/actions/appointments";
import { patientCheckInAction } from "@/lib/actions/queue";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";
import { formatDateTimeIST, formatTimeIST } from "@/lib/time";
import { STREAM_CONFIGS } from "@/lib/streams";
import { EMERGENCY_DISCLAIMER } from "@/lib/queue";
import type { AppointmentStatus } from "@/generated/prisma/enums";
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

  // Auto-refresh every 30 seconds while tab is active and visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [router]);

  const handleCancel = (appointmentId: string) => {
    if (!confirm("Are you sure you want to cancel this appointment? Your slot will be freed.")) {
      return;
    }

    startTransition(async () => {
      const res = await cancelPatientAppointmentAction(appointmentId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error || "Failed to cancel appointment.");
      }
    });
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
      case "PENDING":
        return <Badge variant="warning" className="text-[10px] uppercase font-semibold">Pending Confirmation</Badge>;
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
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Calendar className="h-10 w-10 mb-3 opacity-40 text-primary" />
            <h3 className="font-semibold text-foreground text-base">
              {isUpcomingTab ? "No Upcoming Consultations" : "No Past Appointments"}
            </h3>
            <p className="text-sm mt-1 max-w-sm">
              {isUpcomingTab
                ? "You don't have any upcoming doctor appointments scheduled."
                : "You don't have any past appointment history."}
            </p>
            {isUpcomingTab && (
              <div className="pt-4">
                <Link href="/doctors" className={buttonVariants({ size: "sm" })}>
                  Find a Doctor
                </Link>
              </div>
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

          return (
            <Card
              key={appt.id}
              className={`overflow-hidden border-border shadow-xs hover:border-primary/40 transition-all ${
                isDisrupted ? "border-amber-400 dark:border-amber-800 bg-amber-50/20 dark:bg-amber-950/10" : ""
              }`}
            >
              <CardContent className="p-5 space-y-3">
                {/* Disruption Alert Banner */}
                {isDisrupted && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-amber-100/70 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <div className="text-xs">
                        <strong>Your doctor is unavailable: </strong>
                        <span>{appt.disruptionReason ?? "Schedule disruption"}. Please reschedule or cancel without penalty.</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/book/reschedule/${appt.id}`}
                        className={buttonVariants({ size: "xs", variant: "default", className: "bg-amber-600 hover:bg-amber-700 text-white" })}
                      >
                        Reschedule
                      </Link>
                      <Link
                        href={`/doctors?specialization=${encodeURIComponent(appt.doctor.specialization)}`}
                        className={buttonVariants({ size: "xs", variant: "outline" })}
                      >
                        Other Doctors
                      </Link>
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={isPending}
                        onClick={() => handleCancel(appt.id)}
                      >
                        Cancel
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
                        {formatDateTimeIST(startDate)} - {formatTimeIST(endDate)}
                      </span>
                      <span>•</span>
                      <span>Fee: ₹{appt.doctor.consultationFee.toLocaleString("en-IN")}</span>
                      {appt.arrivalWindow && (
                        <>
                          <span>•</span>
                          <span className="text-primary font-semibold">
                            Arrival Window: {appt.arrivalWindow}
                          </span>
                        </>
                      )}
                    </div>

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
                    {isUpcomingTab && appt.canReschedule && !isDisrupted && (
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

                    {isUpcomingTab && appt.canCancel && !isDisrupted && (
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={isPending}
                        onClick={() => handleCancel(appt.id)}
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
    </div>
  );
}
