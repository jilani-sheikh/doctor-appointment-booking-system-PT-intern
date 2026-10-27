import { requireRole } from "@/lib/auth";
import { Role, DoctorStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { formatDateIST } from "@/lib/time";
import { SlotGeneratorForm } from "./slot-form";
import { SlotList, type SerializedSlot } from "./slot-list";
import { Clock, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default async function DoctorSlotsPage() {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-12">
        <div className="rounded-xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-6 md:p-8 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-foreground">
              Slot Management Locked
            </h1>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto">
              Your doctor profile is currently{" "}
              <span className="font-semibold text-foreground uppercase tracking-wider">
                {doctor?.status ?? "PENDING"}
              </span>
              . Only verified and approved medical practitioners can publish consultation slots.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/doctor/dashboard"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Fetch upcoming slots for this doctor
  const now = new Date();
  const rawSlots = await db.availability.findMany({
    where: {
      doctorId: doctor.id,
      startTime: { gte: now },
    },
    orderBy: {
      startTime: "asc",
    },
  });

  // Group slots by formatted date string in IST
  const slotsGrouped: Record<string, SerializedSlot[]> = {};

  for (const slot of rawSlots) {
    const dateKey = formatDateIST(slot.startTime, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    if (!slotsGrouped[dateKey]) {
      slotsGrouped[dateKey] = [];
    }

    slotsGrouped[dateKey].push({
      id: slot.id,
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      status: slot.status,
    });
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <Clock className="h-7 w-7 text-primary" />
          Consultation Slots
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          Manage your consultation schedule, generate recurring time slots, and block hours as needed.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-5">
          <SlotGeneratorForm />
        </div>
        <div className="lg:col-span-7">
          <SlotList slotsGrouped={slotsGrouped} />
        </div>
      </div>
    </div>
  );
}
