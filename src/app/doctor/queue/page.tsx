import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, DoctorStatus, AppointmentStatus } from "@/generated/prisma/client";
import { getTodayISTDateString, getISTDateString } from "@/lib/time";
import { calculateQueueEstimates, calculateQueueSummary, type QueueAppointmentItem } from "@/lib/queue";
import { toDoctorQueueItemDto, type SerializedDoctorQueueItem } from "@/lib/serializers";
import { DoctorQueueView } from "./doctor-queue-view";
import { Activity, ShieldAlert, ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { scheduleOpportunisticMaintenance } from "@/lib/maintenance";

export const metadata: Metadata = {
  title: "Live Consultation Queue — Doctor Portal",
  description: "Real-time clinical queue management, estimated start times, delay tracking, and patient consultation controls.",
};

export default async function DoctorQueuePage() {
  const user = await requireRole(Role.DOCTOR);
  scheduleOpportunisticMaintenance();
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-12">
        <div className="rounded-xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-8 text-center space-y-4">
          <ShieldAlert className="h-8 w-8 text-amber-600 dark:text-amber-400 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Queue Locked</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Clinical queue management is only accessible for approved medical practitioners.
          </p>
          <div className="pt-2">
            <Link href="/doctor/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const now = new Date();
  const todayISTStr = getTodayISTDateString();

  // Fetch all appointments for doctor
  const rawAppointments = await db.appointment.findMany({
    where: {
      availability: { doctorId: doctor.id },
    },
    include: {
      availability: true,
      patient: {
        include: {
          user: { select: { name: true } },
        },
      },
    },
    orderBy: {
      availability: { startTime: "asc" },
    },
  });

  // Filter for today IST
  const todayAppts = rawAppointments.filter(
    (a) => getISTDateString(a.availability.startTime) === todayISTStr
  );

  const queueItemsInput: QueueAppointmentItem[] = todayAppts.map((a) => ({
    id: a.id,
    status: a.status,
    scheduledStart: a.availability.startTime,
    scheduledEnd: a.availability.endTime,
    actualStartAt: a.actualStartAt,
    actualEndAt: a.actualEndAt,
    checkedInAt: a.checkedInAt,
  }));

  const estimates = calculateQueueEstimates(queueItemsInput, now);
  const summary = calculateQueueSummary(queueItemsInput, estimates);

  // Active queue items (skip completed, cancelled, no-show for the active queue list)
  const activeToday = todayAppts.filter(
    (a) =>
      a.status !== AppointmentStatus.COMPLETED &&
      a.status !== AppointmentStatus.CANCELLED &&
      a.status !== AppointmentStatus.NO_SHOW
  );

  const serializedQueueItems: SerializedDoctorQueueItem[] = activeToday.map((appt) => {
    const est = estimates.get(appt.id)!;
    return toDoctorQueueItemDto(appt, est, now);
  });

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/doctor/dashboard"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Doctor Portal
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1 flex items-center gap-2.5">
            <Activity className="h-7 w-7 text-primary" />
            Live Consultation Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time patient consultation queue, delay propagation, and arrival controls for today.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/doctor/appointments"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            All Consultations
          </Link>
          <Link
            href="/doctor/time-off"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Manage Time Off
          </Link>
        </div>
      </div>

      <DoctorQueueView
        queueItems={serializedQueueItems}
        summary={summary}
      />
    </div>
  );
}
