"use client";

import { useTransition } from "react";
import Link from "next/link";
import { cancelPatientAppointmentAction } from "@/lib/actions/appointments";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Calendar, Clock, Ban } from "lucide-react";
import { formatDateTimeIST, formatTimeIST } from "@/lib/time";
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
  const [isPending, startTransition] = useTransition();

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

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="warning" className="text-[10px] uppercase">Pending Confirmation</Badge>;
      case "CONFIRMED":
        return <Badge variant="success" className="text-[10px] uppercase">Confirmed</Badge>;
      case "COMPLETED":
        return <Badge variant="default" className="text-[10px] uppercase bg-emerald-600">Completed</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive" className="text-[10px] uppercase">Cancelled</Badge>;
      case "NO_SHOW":
        return <Badge variant="destructive" className="text-[10px] uppercase">No Show</Badge>;
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

          return (
            <Card key={appt.id} className="overflow-hidden border-border shadow-xs hover:border-primary/40 transition-all">
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-foreground">
                        Dr. {appt.doctor.name}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {appt.doctor.specialization}
                      </Badge>
                      {getStatusBadge(appt.status)}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        {formatDateTimeIST(startDate)} - {formatTimeIST(endDate)}
                      </span>
                      <span>•</span>
                      <span>Fee: ₹{appt.doctor.consultationFee.toLocaleString("en-IN")}</span>
                    </div>

                    {appt.reason && (
                      <p className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-md border border-border/50 max-w-2xl mt-1">
                        <strong className="text-foreground font-semibold">Reason: </strong>
                        {appt.reason}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border">
                    <Link
                      href={`/doctors/${appt.doctor.id}`}
                      className={buttonVariants({ variant: "outline", size: "xs" })}
                    >
                      Doctor Profile
                    </Link>

                    {isUpcomingTab && appt.canCancel && (
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
