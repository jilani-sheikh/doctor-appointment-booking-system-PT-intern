"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, WaveStatus, NotificationType, AppointmentStatus, DoctorStatus } from "@/generated/prisma/client";
import {
  generateDeterministicWaveWindows,
  formatWaveArrivalWindowIST,
} from "@/lib/waves";
import { parseISTDateTime } from "@/lib/time";
import { createManyNotifications } from "@/lib/notifications";
import {
  createWaveSchema,
  autoGenerateWavesSchema,
  publishWaveSchema,
  reassignWaveAppointmentSchema,
  type CreateWaveInput,
  type AutoGenerateWavesInput,
  type PublishWaveInput,
  type ReassignWaveAppointmentInput,
} from "@/lib/validations/waves";
import { revalidatePath } from "next/cache";

/**
 * Creates a new DRAFT wave manually.
 */
export async function createWaveAction(input: CreateWaveInput) {
  const user = await requireRole(Role.ADMIN);

  const parsed = createWaveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid wave parameters." };
  }

  const { specialization, dateStr, windowStartTime, windowEndTime, capacity, stream, notes } =
    parsed.data;

  const windowStart = parseISTDateTime(dateStr, windowStartTime);
  const windowEnd = parseISTDateTime(dateStr, windowEndTime);

  try {
    const wave = await db.wave.create({
      data: {
        specialization,
        windowStart,
        windowEnd,
        capacity,
        stream: stream ?? null,
        status: WaveStatus.DRAFT,
        notes: notes ?? null,
        createdById: user.id,
      },
    });

    revalidatePath("/admin/waves");
    return { success: true, waveId: wave.id, message: "Draft wave created successfully." };
  } catch (error) {
    console.error("[createWaveAction] Error creating wave:", error);
    return { success: false, error: "Failed to create wave." };
  }
}

/**
 * Deterministically auto-generates sequential DRAFT waves for a specialization and date.
 */
export async function autoGenerateWavesAction(input: AutoGenerateWavesInput) {
  const user = await requireRole(Role.ADMIN);

  const parsed = autoGenerateWavesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid parameters." };
  }

  const { specialization, dateStr, windowMinutes, defaultCapacity, earliestTimeStr, latestTimeStr } =
    parsed.data;

  try {
    const generatedWindows = generateDeterministicWaveWindows({
      specialization,
      dateStr,
      windowMinutes,
      defaultCapacity,
      earliestTimeStr,
      latestTimeStr,
    });

    await db.wave.createMany({
      data: generatedWindows.map((w) => ({
        specialization: w.specialization,
        windowStart: w.windowStart,
        windowEnd: w.windowEnd,
        capacity: w.capacity,
        status: WaveStatus.DRAFT,
        createdById: user.id,
      })),
    });

    revalidatePath("/admin/waves");
    return {
      success: true,
      message: `Generated ${generatedWindows.length} draft waves for ${specialization} on ${dateStr}.`,
    };
  } catch (error) {
    console.error("[autoGenerateWavesAction] Error:", error);
    return { success: false, error: "Failed to auto-generate waves." };
  }
}

/**
 * Reassigns or removes an appointment from a wave.
 *
 * Rules (Promt5.md Amendment 5b):
 * - If target wave is CLOSED: reject (read-only).
 * - If target wave is PUBLISHED: allow only if capacity remains, otherwise reject.
 */
export async function reassignWaveAppointmentAction(input: ReassignWaveAppointmentInput) {
  await requireRole(Role.ADMIN);

  const parsed = reassignWaveAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid parameters." };
  }

  const { appointmentId, targetWaveId } = parsed.data;

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
  });

  if (!appointment) {
    return { success: false, error: "Appointment not found." };
  }

  if (targetWaveId === null) {
    // Remove from wave
    await db.appointment.update({
      where: { id: appointmentId },
      data: { waveId: null },
    });

    revalidatePath("/admin/waves");
    return { success: true, message: "Appointment removed from wave." };
  }

  const targetWave = await db.wave.findUnique({
    where: { id: targetWaveId },
    include: {
      _count: { select: { appointments: true } },
    },
  });

  if (!targetWave) {
    return { success: false, error: "Target wave not found." };
  }

  if (targetWave.status === WaveStatus.CLOSED) {
    return { success: false, error: "Cannot assign to a CLOSED wave." };
  }

  if (targetWave.status === WaveStatus.PUBLISHED) {
    if (targetWave._count.appointments >= targetWave.capacity) {
      return {
        success: false,
        error: `Published wave is already at full capacity (${targetWave.capacity}/${targetWave.capacity}). Appointment remains unassigned.`,
      };
    }
  }

  try {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { waveId: targetWaveId },
    });

    revalidatePath("/admin/waves");
    revalidatePath(`/admin/waves/${targetWaveId}`);

    return { success: true, message: "Appointment assigned to wave." };
  } catch (error) {
    console.error("[reassignWaveAppointmentAction] Error:", error);
    return { success: false, error: "Failed to reassign appointment." };
  }
}

/**
 * Publishes a wave.
 *
 * Overflow & Notification Invariants (Promt5.md Amendment 5d):
 * 1. Checks for unassigned overflow in the wave's specialization & time window.
 * 2. Blocks publishing if overflow exists, unless explicitly acknowledged by admin.
 * 3. Assigns matching appointments if not already assigned.
 * 4. Sets wave status to PUBLISHED and publishedAt.
 * 5. Notifies assigned patients with their specific IST arrival window.
 */
export async function publishWaveAction(input: PublishWaveInput) {
  await requireRole(Role.ADMIN);

  const parsed = publishWaveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid parameters." };
  }

  const { waveId, acknowledgeOverflow } = parsed.data;

  const wave = await db.wave.findUnique({
    where: { id: waveId },
    include: {
      appointments: {
        include: { patient: { select: { userId: true } } },
      },
    },
  });

  if (!wave) {
    return { success: false, error: "Wave not found." };
  }

  if (wave.status !== WaveStatus.DRAFT) {
    return { success: false, error: `Wave is already in ${wave.status} status.` };
  }

  // Find all confirmed appointments in this specialization during this wave window
  const matchingCandidates = await db.appointment.findMany({
    where: {
      status: AppointmentStatus.CONFIRMED,
      availability: {
        doctor: {
          specialization: wave.specialization,
          status: DoctorStatus.APPROVED,
        },
        startTime: { gte: wave.windowStart, lt: wave.windowEnd },
      },
    },
    include: {
      patient: { select: { userId: true } },
    },
  });

  const overflowCount = Math.max(0, matchingCandidates.length - wave.capacity);

  if (overflowCount > 0 && !acknowledgeOverflow) {
    return {
      success: false,
      error: `This wave has ${overflowCount} overflow appointment(s) that exceed capacity. Please acknowledge overflow before publishing.`,
      hasOverflow: true,
      overflowCount,
    };
  }

  const now = new Date();

  try {
    // 1. Assign matching unassigned appointments up to capacity
    const appointmentsToAssign = matchingCandidates.slice(0, wave.capacity);

    await db.$transaction(async (tx) => {
      if (appointmentsToAssign.length > 0) {
        await tx.appointment.updateMany({
          where: { id: { in: appointmentsToAssign.map((a) => a.id) } },
          data: { waveId: wave.id },
        });
      }

      await tx.wave.update({
        where: { id: wave.id },
        data: {
          status: WaveStatus.PUBLISHED,
          publishedAt: now,
        },
      });
    });

    // 2. Notify assigned patients with their arrival window
    const arrivalWindowText = formatWaveArrivalWindowIST(wave.windowStart, wave.windowEnd);
    const assignedUserIds = appointmentsToAssign.map((a) => a.patient.userId);

    if (assignedUserIds.length > 0) {
      await createManyNotifications(
        assignedUserIds.map((userId) => ({
          userId,
          type: NotificationType.WAVE_PUBLISHED,
          title: "Consultation Arrival Window Assigned",
          body: `Your consultation wave has been published. Please arrive between ${arrivalWindowText}.`,
          href: "/patient/appointments",
        }))
      );
    }

    revalidatePath("/admin/waves");
    revalidatePath(`/admin/waves/${wave.id}`);
    revalidatePath("/patient/appointments");

    return {
      success: true,
      message: `Wave successfully published! ${assignedUserIds.length} patient(s) notified of their arrival window.`,
    };
  } catch (error) {
    console.error("[publishWaveAction] Error publishing wave:", error);
    return { success: false, error: "Failed to publish wave." };
  }
}
