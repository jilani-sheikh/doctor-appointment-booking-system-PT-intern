"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDoctorAppointmentStatusAction } from "@/lib/actions/doctor-appointments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Ban,
  UserX,
  Phone,
  User,
  FileText,
} from "lucide-react";
import { formatDateTimeIST, formatTimeIST } from "@/lib/time";
import { STREAM_CONFIGS } from "@/lib/streams";
import Link from "next/link";
import type { AppointmentStatus } from "@/generated/prisma/enums";
import type { SerializedDoctorAppointment } from "@/lib/serializers";
export type { SerializedDoctorAppointment };

interface DoctorAppointmentsViewProps {
  todayAppointments: SerializedDoctorAppointment[];
  upcomingAppointments: SerializedDoctorAppointment[];
  historyAppointments: SerializedDoctorAppointment[];
}

export function DoctorAppointmentsView({
  todayAppointments,
  upcomingAppointments,
  historyAppointments,
}: DoctorAppointmentsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Auto-refresh appointments every 30 seconds while tab is active and visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [router]);

  const handleStatusChange = (
    appointmentId: string,
    targetStatus: "CANCELLED" | "COMPLETED" | "NO_SHOW"
  ) => {
    const actionLabel =
      targetStatus === "CANCELLED"
        ? "cancel this appointment and free the slot"
        : targetStatus === "COMPLETED"
        ? "mark this consultation as completed"
        : "record this as a no-show";

    if (!confirm(`Are you sure you want to ${actionLabel}?`)) return;

    startTransition(async () => {
      const res = await updateDoctorAppointmentStatusAction(appointmentId, targetStatus);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error || "Failed to update appointment status.");
      }
    });
  };

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="warning" className="text-[10px] uppercase">Pending</Badge>;
      case "CONFIRMED":
        return <Badge variant="success" className="text-[10px] uppercase">Confirmed</Badge>;
      case "CHECKED_IN":
        return <Badge variant="default" className="text-[10px] uppercase bg-blue-600 text-white">Checked In</Badge>;
      case "IN_CONSULTATION":
        return <Badge variant="default" className="text-[10px] uppercase bg-amber-600 text-white animate-pulse">In Consultation</Badge>;
      case "COMPLETED":
        return <Badge variant="default" className="text-[10px] uppercase bg-emerald-600">Completed</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive" className="text-[10px] uppercase">Cancelled</Badge>;
      case "NO_SHOW":
        return <Badge variant="destructive" className="text-[10px] uppercase bg-rose-700">No Show</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] uppercase">{status}</Badge>;
    }
  };

  const renderAppointmentCard = (appt: SerializedDoctorAppointment) => {
    const startDate = new Date(appt.slotStartTime);
    const endDate = new Date(appt.slotEndTime);

    return (
      <Card
        key={appt.id}
        className="overflow-hidden border-border shadow-xs hover:border-primary/40 transition-all"
      >
        <CardContent className="p-5">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base text-foreground flex items-center gap-1.5">
                  <User className="h-4 w-4 text-primary" />
                  {appt.patient.name}
                </span>
                {getStatusBadge(appt.status)}
                {appt.stream && (
                  <span
                    className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${STREAM_CONFIGS[appt.stream]?.badgeClassName ?? "bg-muted text-foreground"}`}
                  >
                    {STREAM_CONFIGS[appt.stream]?.label ?? appt.stream}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  {formatDateTimeIST(startDate)} - {formatTimeIST(endDate)}
                </span>
                {appt.patient.phone && (
                  <span className="flex items-center gap-1 text-foreground/80">
                    <Phone className="h-3 w-3" />
                    {appt.patient.phone}
                  </span>
                )}
                {appt.patient.gender && <span>Gender: {appt.patient.gender}</span>}
              </div>

              {appt.reason ? (
                <div className="bg-muted/30 p-2.5 rounded-md border border-border/50 text-xs text-muted-foreground max-w-2xl mt-1">
                  <span className="font-semibold text-foreground flex items-center gap-1 mb-0.5">
                    <FileText className="h-3 w-3" />
                    Patient Reason:
                  </span>
                  {appt.reason}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No consultation notes provided</p>
              )}
            </div>

            {/* Actions based on transition table */}
            <div className="flex flex-wrap items-center gap-2 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-border">
              {(appt.status === "CHECKED_IN" || appt.status === "IN_CONSULTATION") && (
                <Link href="/doctor/queue">
                  <Button
                    variant="default"
                    size="xs"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1"
                  >
                    Manage in Live Queue &rarr;
                  </Button>
                </Link>
              )}

              {appt.status === "CONFIRMED" && (
                <>
                  <Button
                    variant="default"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleStatusChange(appt.id, "COMPLETED")}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Complete
                  </Button>

                  <Button
                    variant="outline"
                    size="xs"
                    disabled={isPending || !appt.isPastStartTime}
                    title={
                      !appt.isPastStartTime
                        ? "No-Show can only be marked after consultation start time"
                        : "Mark patient as No-Show"
                    }
                    onClick={() => handleStatusChange(appt.id, "NO_SHOW")}
                    className="text-rose-600 border-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/20 gap-1 text-xs"
                  >
                    <UserX className="h-3 w-3" />
                    No Show
                  </Button>

                  <Button
                    variant="destructive"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleStatusChange(appt.id, "CANCELLED")}
                    className="gap-1"
                  >
                    <Ban className="h-3 w-3" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderEmptyTab = (message: string) => (
    <Card className="border-dashed border-2">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <Calendar className="h-10 w-10 mb-3 opacity-40 text-primary" />
        <h3 className="font-semibold text-foreground text-base">{message}</h3>
        <p className="text-sm mt-1 max-w-sm">
          Any patient bookings matching this criteria will appear here automatically.
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <Tabs defaultValue="today" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3 mb-6">
          <TabsTrigger value="today">
            Today ({todayAppointments.length})
          </TabsTrigger>
          <TabsTrigger value="upcoming">
            Upcoming ({upcomingAppointments.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            History ({historyAppointments.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          {todayAppointments.length === 0
            ? renderEmptyTab("No Consultations Scheduled Today")
            : <div className="space-y-4">{todayAppointments.map(renderAppointmentCard)}</div>}
        </TabsContent>

        <TabsContent value="upcoming">
          {upcomingAppointments.length === 0
            ? renderEmptyTab("No Future Upcoming Appointments")
            : <div className="space-y-4">{upcomingAppointments.map(renderAppointmentCard)}</div>}
        </TabsContent>

        <TabsContent value="history">
          {historyAppointments.length === 0
            ? renderEmptyTab("No Past Appointment History")
            : <div className="space-y-4">{historyAppointments.map(renderAppointmentCard)}</div>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
