import { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, AppointmentStatus } from "@/generated/prisma/client";
import { getTodayISTDateString, getISTDayRangeUTC } from "@/lib/time";
import { toWaveDto } from "@/lib/serializers";
import { calculateWaveMetrics } from "@/lib/waves";
import { DoctorWavesView } from "../waves/doctor-waves-view";
import { effectiveSlot } from "@/lib/scheduling";

export const metadata: Metadata = {
  title: "Arrival Windows — Medrella",
  description: "Manage doctor-owned arrival windows.",
};

export default async function ArrivalWindowsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireRole(Role.DOCTOR);
  const date = (await searchParams).date ?? getTodayISTDateString();
  const { start, end } = getISTDayRangeUTC(date);
  const doctor = await db.doctor.findUnique({ where: { userId: user.id }, select: { id: true, specialization: true, waveWindowMinutes: true, waveCapacity: true, arrivalBufferMinutes: true, autoPublishWaves: true } });
  if (!doctor) throw new Error("Doctor profile not found.");
  const waves = await db.wave.findMany({
    where: { doctorId: doctor.id, windowStart: { gte: start, lte: end } },
    include: { appointments: { include: { patient: { select: { id: true, phone: true, user: { select: { name: true } } } }, availability: true }, orderBy: { availability: { startTime: "asc" } } } },
    orderBy: { windowStart: "asc" },
  });
  const serialized = waves.map((wave) => {
    const metrics = calculateWaveMetrics({ windowEnd: wave.windowEnd }, wave.appointments.map((appointment) => ({ status: appointment.status, checkedInAt: appointment.checkedInAt })));
    return {
      ...toWaveDto({ ...wave, _count: { appointments: wave.appointments.length } }, metrics),
      appointments: wave.appointments.map((appointment) => ({
        id: appointment.id, patientId: appointment.patientId, patientName: appointment.patient.user.name ?? "Patient",
        patientPhone: appointment.patient.phone, status: appointment.status, stream: appointment.stream,
        slotStartTime: effectiveSlot(appointment).start.toISOString(),
        slotEndTime: effectiveSlot(appointment).end.toISOString(),
        checkedInAt: appointment.checkedInAt?.toISOString() ?? null,
      })),
    };
  });
  const unassigned = await db.appointment.findMany({
    where: { availability: { doctorId: doctor.id, startTime: { gte: start, lte: end } }, waveId: null, status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION, AppointmentStatus.COMPLETED] } },
    include: { patient: { select: { id: true, phone: true, user: { select: { name: true } } } }, availability: true },
    orderBy: { availability: { startTime: "asc" } },
  });
  return <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8"><DoctorWavesView dateStr={date} doctorSettings={{ waveWindowMinutes: doctor.waveWindowMinutes, waveCapacity: doctor.waveCapacity, arrivalBufferMinutes: doctor.arrivalBufferMinutes, autoPublishWaves: doctor.autoPublishWaves }} waves={serialized as never} unassignedAppointments={unassigned.map((appointment) => ({ id: appointment.id, patientId: appointment.patientId, patientName: appointment.patient.user.name ?? "Patient", patientPhone: appointment.patient.phone, status: appointment.status, stream: appointment.stream, slotStartTime: effectiveSlot(appointment).start.toISOString(), slotEndTime: effectiveSlot(appointment).end.toISOString(), checkedInAt: appointment.checkedInAt?.toISOString() ?? null }))} /></div>;
}
