import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AvailabilityKind, Role, SlotStatus } from "@/generated/prisma/client";
import { MAX_RESCHEDULE_COUNT } from "@/lib/appointment-status";
import { toPublicSlotDto, type SerializedPublicSlot } from "@/lib/serializers";
import { RescheduleView } from "./reschedule-view";
import { RotateCcw, ArrowLeft } from "lucide-react";
import { effectiveSlot } from "@/lib/scheduling";
import { discoverAlternativeAppointmentsForPatient } from "@/lib/actions/reschedule";

export const metadata: Metadata = {
  title: "Reschedule Consultation — Medrella",
  description: "Select a new available consultation time with your doctor.",
};

export default async function ReschedulePage({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    redirect("/onboarding");
  }

  const { appointmentId } = await params;

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: {
        include: {
          doctor: {
            include: { user: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!appointment || appointment.patientId !== user.patient.id) {
    notFound();
  }

  const doctor = appointment.availability.doctor;
  const currentAppointmentSlot = effectiveSlot(appointment);
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const compatibleKinds =
    appointment.availability.kind === AvailabilityKind.STREAM_WINDOW
      ? [AvailabilityKind.STREAM_WINDOW]
      : [AvailabilityKind.SINGLE, AvailabilityKind.WAVE_SLOT];

  // Fetch doctor's other available compatible slots in the next 14 days and three-level suggestions
  const [rawSlots, suggestedAlternatives] = await Promise.all([
    db.availability.findMany({
      where: {
        doctorId: doctor.id,
        id: { not: appointment.availabilityId },
        status: SlotStatus.AVAILABLE,
        blockedByTimeOffId: null,
        kind: { in: compatibleKinds },
        startTime: { gt: oneHourFromNow, lte: fourteenDaysFromNow },
      },
      include: {
        parent: { select: { startTime: true, endTime: true, status: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    discoverAlternativeAppointmentsForPatient(appointment.id, now),
  ]);

  // Group eligible slots by IST date label
  const slotsGrouped: Record<string, SerializedPublicSlot[]> = {};
  for (const s of rawSlots) {
    if (s.activeCount >= s.capacity) continue;
    if (
      s.kind === AvailabilityKind.WAVE_SLOT &&
      s.parent &&
      (s.startTime < s.parent.startTime ||
        s.endTime > s.parent.endTime ||
        s.parent.status === SlotStatus.BLOCKED)
    ) {
      continue;
    }

    const dateLabel = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(s.startTime);

    if (!slotsGrouped[dateLabel]) {
      slotsGrouped[dateLabel] = [];
    }
    slotsGrouped[dateLabel].push(toPublicSlotDto(s));
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6">
      <div className="border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <Link
            href="/patient/appointments"
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            My Consultations
          </Link>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1 flex items-center gap-2.5">
          <RotateCcw className="h-7 w-7 text-primary" />
          Reschedule Consultation
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Choose a new available slot with Dr. {doctor.user.name ?? "Practitioner"}. Your existing slot will be freed immediately upon confirmation.
        </p>
      </div>

      <RescheduleView
        appointmentId={appointment.id}
        doctorName={doctor.user.name ?? "Practitioner"}
        specialization={doctor.specialization}
        currentSlotStart={currentAppointmentSlot.start.toISOString()}
        currentSlotEnd={currentAppointmentSlot.end.toISOString()}
        rescheduleCount={appointment.rescheduleCount}
        maxRescheduleCount={MAX_RESCHEDULE_COUNT}
        isDisrupted={
          Boolean(appointment.disruptedAt) ||
          appointment.rescheduleStatus === "PENDING_RESCHEDULING"
        }
        disruptionReason={appointment.disruptionReason}
        suggestedAlternatives={suggestedAlternatives}
        slotsGrouped={slotsGrouped}
      />
    </div>
  );
}
