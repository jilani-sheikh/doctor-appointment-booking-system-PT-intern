import { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, AppointmentStatus } from "@/generated/prisma/client";
import { getTodayISTDateString, getISTDayRangeUTC } from "@/lib/time";
import { toWaveDto, type SerializedWave } from "@/lib/serializers";
import { calculateWaveMetrics } from "@/lib/waves";
import { DoctorWavesView } from "./doctor-waves-view";

export const metadata: Metadata = {
  title: "Arrival Wave Scheduling — Medrella",
  description: "Doctor-owned automatic wave scheduling over fixed consultation slots.",
};

interface DoctorWavesPageProps {
  searchParams: Promise<{ date?: string }>;
}

export interface SerializedDoctorWaveWithAppointments extends SerializedWave {
  appointments: Array<{
    id: string;
    patientId: string;
    patientName: string;
    patientPhone?: string | null;
    status: AppointmentStatus;
    stream: string;
    slotStartTime: string;
    slotEndTime: string;
    checkedInAt?: string | null;
  }>;
}

export interface SerializedUnassignedAppointment {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string | null;
  status: AppointmentStatus;
  stream: string;
  slotStartTime: string;
  slotEndTime: string;
  checkedInAt?: string | null;
}

export default async function DoctorWavesPage({ searchParams }: DoctorWavesPageProps) {
  const user = await requireRole(Role.DOCTOR);
  const resolvedParams = await searchParams;
  const dateStr = resolvedParams.date ?? getTodayISTDateString();
  const { start: dayStart, end: dayEnd } = getISTDayRangeUTC(dateStr);

  const doctor = await db.doctor.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      specialization: true,
      waveWindowMinutes: true,
      waveCapacity: true,
      arrivalBufferMinutes: true,
      autoPublishWaves: true,
    },
  });

  if (!doctor) {
    throw new Error("Doctor profile not found.");
  }

  // 1. Fetch doctor's waves on this date
  const rawWaves = await db.wave.findMany({
    where: {
      doctorId: doctor.id,
      windowStart: { gte: dayStart, lte: dayEnd },
    },
    include: {
      appointments: {
        include: {
          patient: { select: { id: true, phone: true, user: { select: { name: true, email: true } } } },
          availability: true,
        },
        orderBy: {
          availability: { startTime: "asc" },
        },
      },
    },
    orderBy: {
      windowStart: "asc",
    },
  });

  // Calculate metrics for each wave
  const waves: SerializedDoctorWaveWithAppointments[] = rawWaves.map((wave) => {
    const metrics = calculateWaveMetrics(
      { windowEnd: wave.windowEnd },
      wave.appointments.map((a) => ({
        status: a.status,
        checkedInAt: a.checkedInAt,
      }))
    );

    return {
      ...toWaveDto(
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
      ),
      appointments: wave.appointments.map((a) => ({
        id: a.id,
        patientId: a.patientId,
        patientName: a.patient.user.name ?? "Patient",
        patientPhone: a.patient.phone,
        status: a.status,
        stream: a.stream,
        slotStartTime: a.availability.startTime.toISOString(),
        slotEndTime: a.availability.endTime.toISOString(),
        checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
      })),
    };
  });

  // 2. Fetch unassigned active appointments for this doctor on this date
  const rawUnassigned = await db.appointment.findMany({
    where: {
      availability: {
        doctorId: doctor.id,
        startTime: { gte: dayStart, lte: dayEnd },
      },
      status: {
        in: [
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.IN_CONSULTATION,
          AppointmentStatus.COMPLETED,
        ],
      },
      waveId: null,
    },
    include: {
      patient: { select: { id: true, phone: true, user: { select: { name: true } } } },
      availability: true,
    },
    orderBy: {
      availability: { startTime: "asc" },
    },
  });

  const unassignedAppointments: SerializedUnassignedAppointment[] = rawUnassigned.map((a) => ({
    id: a.id,
    patientId: a.patientId,
    patientName: a.patient.user.name ?? "Patient",
    patientPhone: a.patient.phone,
    status: a.status,
    stream: a.stream,
    slotStartTime: a.availability.startTime.toISOString(),
    slotEndTime: a.availability.endTime.toISOString(),
    checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
  }));

  const doctorSettings = {
    waveWindowMinutes: doctor.waveWindowMinutes,
    waveCapacity: doctor.waveCapacity,
    arrivalBufferMinutes: doctor.arrivalBufferMinutes,
    autoPublishWaves: doctor.autoPublishWaves,
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <DoctorWavesView
        dateStr={dateStr}
        doctorSettings={doctorSettings}
        waves={waves}
        unassignedAppointments={unassignedAppointments}
      />
    </div>
  );
}
