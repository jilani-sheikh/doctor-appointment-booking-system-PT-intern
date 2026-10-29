import { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, AppointmentStatus, DoctorStatus } from "@/generated/prisma/client";
import { WaveDetailView } from "./wave-detail-view";
import { toWaveDto, type SerializedWave } from "@/lib/serializers";
import { calculateWaveMetrics, type WaveTarget } from "@/lib/waves";

export const metadata: Metadata = {
  title: "Review Arrival Wave — Admin Portal",
  description: "Review assigned patient appointments, balance overflow, and publish wave arrival windows.",
};

export default async function AdminWaveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(Role.ADMIN);
  const { id } = await params;

  const wave = await db.wave.findUnique({
    where: { id },
    include: {
      _count: { select: { appointments: true } },
      appointments: {
        include: {
          patient: {
            include: { user: { select: { name: true } } },
          },
          availability: {
            include: {
              doctor: {
                include: { user: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!wave) {
    notFound();
  }

  const target: WaveTarget = {
    id: wave.id,
    specialization: wave.specialization,
    windowStart: wave.windowStart,
    windowEnd: wave.windowEnd,
    capacity: wave.capacity,
    stream: wave.stream,
    status: wave.status,
  };

  const metrics = calculateWaveMetrics(target, wave.appointments);
  const serializedWave: SerializedWave = toWaveDto(wave, metrics);

  // Find all confirmed appointments in this department within this window that are not assigned to this wave
  const unassignedRaw = await db.appointment.findMany({
    where: {
      status: AppointmentStatus.CONFIRMED,
      waveId: null,
      availability: {
        doctor: {
          specialization: wave.specialization,
          status: DoctorStatus.APPROVED,
        },
        startTime: { gte: wave.windowStart, lt: wave.windowEnd },
      },
    },
    include: {
      patient: { include: { user: { select: { name: true } } } },
      availability: {
        include: { doctor: { include: { user: { select: { name: true } } } } },
      },
    },
  });

  // Other waves in the same specialization
  const otherWavesRaw = await db.wave.findMany({
    where: {
      specialization: wave.specialization,
      id: { not: wave.id },
    },
    include: {
      _count: { select: { appointments: true } },
    },
  });

  const otherWaves = otherWavesRaw.map((w) => ({
    id: w.id,
    windowStart: w.windowStart.toISOString(),
    windowEnd: w.windowEnd.toISOString(),
    status: w.status,
    assignedCount: w._count.appointments,
    capacity: w.capacity,
  }));

  const assignedAppointments = wave.appointments.map((a) => ({
    id: a.id,
    patientName: a.patient.user.name ?? "Patient",
    doctorName: a.availability.doctor.user.name ?? "Practitioner",
    stream: a.stream,
    status: a.status,
    slotStartTime: a.availability.startTime.toISOString(),
    slotEndTime: a.availability.endTime.toISOString(),
    checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
  }));

  const unassignedAppointments = unassignedRaw.map((a) => ({
    id: a.id,
    patientName: a.patient.user.name ?? "Patient",
    doctorName: a.availability.doctor.user.name ?? "Practitioner",
    stream: a.stream,
    status: a.status,
    slotStartTime: a.availability.startTime.toISOString(),
    slotEndTime: a.availability.endTime.toISOString(),
    checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
  }));

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <WaveDetailView
        wave={serializedWave}
        assignedAppointments={assignedAppointments}
        unassignedAppointments={unassignedAppointments}
        otherWaves={otherWaves}
      />
    </div>
  );
}
