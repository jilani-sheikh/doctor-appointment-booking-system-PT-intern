import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppointmentStatus, DoctorStatus, Role } from "@/generated/prisma/client";
import { buildDoctorLiveQueueData } from "@/lib/doctor-queue";
import { DoctorQueueView } from "./doctor-queue-view";
import { Activity, ShieldAlert, ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { scheduleOpportunisticMaintenance } from "@/lib/maintenance";
import { getISTDayRangeUTC, getTodayISTDateString } from "@/lib/time";

export const metadata: Metadata = {
  title: "Live Consultation Queue — Doctor Portal",
  description: "Read-only live consultation queue view showing token numbers, statuses, and estimated wait times per sub-slot.",
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
            Live queue monitoring is only accessible for approved medical practitioners.
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
  const todayIST = getTodayISTDateString();
  const dayRange = getISTDayRangeUTC(todayIST);
  const queryStart = new Date(dayRange.start.getTime() - 24 * 60 * 60 * 1000);
  const queryEnd = new Date(dayRange.nextDayStart.getTime() + 24 * 60 * 60 * 1000);

  const rawAppointments = await db.appointment.findMany({
    where: {
      availability: {
        doctorId: doctor.id,
        startTime: {
          gte: queryStart,
          lt: queryEnd,
        },
      },
      status: {
        notIn: [
          AppointmentStatus.PENDING_PAYMENT,
          AppointmentStatus.CANCELLED,
        ],
      },
    },
    include: {
      availability: true,
      wave: {
        select: {
          windowStart: true,
          windowEnd: true,
          status: true,
        },
      },
      patient: {
        select: {
          id: true,
          dateOfBirth: true,
          gender: true,
          user: { select: { name: true } },
        },
      },
      _count: {
        select: {
          prescriptions: true,
        },
      },
    },
    orderBy: {
      availability: { startTime: "asc" },
    },
  });

  const liveQueueData = buildDoctorLiveQueueData(rawAppointments, now);

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
            Read-only live view of today&apos;s sub-slot queues, persisted token numbers, and estimated times. Queue calls and consultation transitions are operated by the Reception Desk.
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

      <DoctorQueueView data={liveQueueData} />
    </div>
  );
}
