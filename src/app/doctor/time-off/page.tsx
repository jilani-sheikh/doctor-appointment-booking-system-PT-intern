import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, DoctorStatus } from "@/generated/prisma/client";
import { DoctorTimeOffForm } from "./time-off-form";
import { DoctorTimeOffList } from "./time-off-list";
import { toDoctorTimeOffDto, type SerializedDoctorTimeOff } from "@/lib/serializers";
import { CalendarOff, ShieldAlert, ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Practitioner Time Off — Doctor Portal",
  description: "Schedule leaves, block consultation slots, and manage planned clinical absences.",
};

export default async function DoctorTimeOffPage() {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-12">
        <div className="rounded-xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-8 text-center space-y-4">
          <ShieldAlert className="h-8 w-8 text-amber-600 dark:text-amber-400 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Time Off Locked</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Absence management is restricted to approved practitioners.
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
  const rawTimeOffs = await db.doctorTimeOff.findMany({
    where: { doctorId: doctor.id },
    orderBy: { startAt: "desc" },
  });

  const serializedTimeOffs: SerializedDoctorTimeOff[] = rawTimeOffs.map((t) =>
    toDoctorTimeOffDto(t, now)
  );

  return (
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-8">
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
            <CalendarOff className="h-7 w-7 text-primary" />
            Practitioner Time Off
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure planned absences. Unbooked consultation slots in the range will be blocked automatically.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/doctor/queue" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Live Queue
          </Link>
          <Link href="/doctor/slots" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Manage Slots
          </Link>
        </div>
      </div>

      <div className="space-y-8">
        <DoctorTimeOffForm />

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-foreground">Absence History & Scheduled Leaves</h3>
          <DoctorTimeOffList timeOffs={serializedTimeOffs} />
        </div>
      </div>
    </div>
  );
}
