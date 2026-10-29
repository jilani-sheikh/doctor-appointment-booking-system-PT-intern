import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { toWaveDto } from "@/lib/serializers";
import { calculateWaveMetrics } from "@/lib/waves";
import { getISTDateString, getISTDayRangeUTC } from "@/lib/time";
import { DoctorWaveDetailView } from "./doctor-wave-detail-view";

export const metadata: Metadata = {
  title: "Wave Details — Medrella",
  description: "View and manage wave arrival window and patient assignments.",
};

interface DoctorWaveDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function DoctorWaveDetailPage({ params }: DoctorWaveDetailPageProps) {
  const user = await requireRole(Role.DOCTOR);
  const { id } = await params;

  const doctor = await db.doctor.findUnique({
    where: { userId: user.id },
  });

  if (!doctor) {
    redirect("/sign-in");
  }

  const wave = await db.wave.findUnique({
    where: { id },
    include: {
      appointments: {
        include: {
          patient: {
            select: {
              id: true,
              phone: true,
              gender: true,
              user: { select: { name: true, email: true } },
            },
          },
          availability: true,
        },
        orderBy: {
          availability: { startTime: "asc" },
        },
      },
    },
  });

  if (!wave || wave.doctorId !== doctor.id) {
    notFound();
  }

  const waveDateStr = getISTDateString(wave.windowStart);
  const { start: dayStart, end: dayEnd } = getISTDayRangeUTC(waveDateStr);

  // Fetch sibling waves for this doctor on this day (for reassigning)
  const siblingWaves = await db.wave.findMany({
    where: {
      doctorId: doctor.id,
      id: { not: wave.id },
      windowStart: { gte: dayStart, lte: dayEnd },
    },
    include: {
      _count: { select: { appointments: true } },
    },
    orderBy: { windowStart: "asc" },
  });

  const metrics = calculateWaveMetrics(
    { windowEnd: wave.windowEnd },
    wave.appointments.map((a) => ({
      status: a.status,
      checkedInAt: a.checkedInAt,
    }))
  );

  const serializedWave = toWaveDto(
    {
      id: wave.id,
      doctorId: wave.doctorId,
      specialization: wave.specialization,
      windowStart: wave.windowStart,
      windowEnd: wave.windowEnd,
      capacity: wave.capacity,
      stream: wave.stream,
      status: wave.status,
      notes: wave.notes,
      publishedAt: wave.publishedAt,
      createdAt: wave.createdAt,
      _count: { appointments: wave.appointments.length },
    },
    metrics
  );

  const serializedAppointments = wave.appointments.map((a) => ({
    id: a.id,
    patientId: a.patientId,
    patientName: a.patient.user.name ?? "Patient",
    patientEmail: a.patient.user.email,
    patientPhone: a.patient.phone,
    patientGender: a.patient.gender,
    status: a.status,
    stream: a.stream,
    slotStartTime: a.availability.startTime.toISOString(),
    slotEndTime: a.availability.endTime.toISOString(),
    checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
  }));

  const serializedSiblingWaves = siblingWaves.map((w) => ({
    id: w.id,
    windowStart: w.windowStart.toISOString(),
    windowEnd: w.windowEnd.toISOString(),
    capacity: w.capacity,
    assignedCount: w._count.appointments,
    status: w.status,
  }));

  return (
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <DoctorWaveDetailView
        wave={serializedWave}
        appointments={serializedAppointments}
        siblingWaves={serializedSiblingWaves}
        dateStr={waveDateStr}
      />
    </div>
  );
}
