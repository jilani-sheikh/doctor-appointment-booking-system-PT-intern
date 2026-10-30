"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, WaveStatus, NotificationType, AppointmentStatus } from "@/generated/prisma/client";
import {
  generateDoctorWaveSchedule,
  validateManualWaveOverlap,
  formatWaveArrivalWindowIST,
} from "@/lib/waves";
import { getISTDayRangeUTC, parseISTDateTime } from "@/lib/time";
import {
  doctorWaveSettingsSchema,
  generateDoctorWavesSchema,
  createDoctorManualWaveSchema,
  publishDoctorWaveSchema,
  reassignDoctorWaveAppointmentSchema,
  deleteDoctorDraftWaveSchema,
  type DoctorWaveSettingsInput,
  type GenerateDoctorWavesInput,
  type CreateDoctorManualWaveInput,
  type PublishDoctorWaveInput,
  type ReassignDoctorWaveAppointmentInput,
  type DeleteDoctorDraftWaveInput,
} from "@/lib/validations/waves";
import { revalidatePath } from "next/cache";
import { enqueuePatientNotifications } from "@/lib/notifications/index";

/**
 * Updates a doctor's default wave scheduling preferences.
 */
export async function updateDoctorWaveSettingsAction(input: DoctorWaveSettingsInput) {
  const user = await requireRole(Role.DOCTOR);

  const parsed = doctorWaveSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid settings." };
  }

  const doctor = await db.doctor.findUnique({
    where: { userId: user.id },
  });

  if (!doctor) {
    return { success: false, error: "Doctor profile not found." };
  }

  try {
    await db.doctor.update({
      where: { id: doctor.id },
      data: {
        waveWindowMinutes: parsed.data.waveWindowMinutes,
        waveCapacity: parsed.data.waveCapacity,
        arrivalBufferMinutes: parsed.data.arrivalBufferMinutes,
        autoPublishWaves: parsed.data.autoPublishWaves,
      },
    });

    revalidatePath("/doctor/waves");
    return { success: true, message: "Wave scheduling settings updated successfully." };
  } catch (error) {
    console.error("[updateDoctorWaveSettingsAction] Error updating settings:", error);
    return { success: false, error: "Failed to update wave settings." };
  }
}

/**
 * Generates doctor-owned wave scheduling windows over fixed consultation slots.
 *
 * Concurrency & Idempotency Guarantees (Amendment 4):
 * - Locks the doctor row (SELECT id FROM doctors WHERE id = $1 FOR UPDATE)
 * - Runs delete-DRAFT-waves, create-waves, and assign-appointments in one short transaction
 * - Published waves are NEVER altered or deleted
 * - Deleting DRAFT waves clears waveId on appointments (SetNull)
 * - Notifications sent once per patient per wave with duplicate avoidance
 */
export type GenerateDoctorWavesResult =
  | {
      success: true;
      message: string;
      createdCount: number;
      unassignedCount: number;
      unassignedReasons: Array<{ id: string; reason: string }>;
      isPublished: boolean;
    }
  | {
      success: false;
      error: string;
    };

export async function generateDoctorWavesAction(
  input: GenerateDoctorWavesInput
): Promise<GenerateDoctorWavesResult> {
  const user = await requireRole(Role.DOCTOR);

  const parsed = generateDoctorWavesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid generation parameters." };
  }

  const doctor = await db.doctor.findUnique({
    where: { userId: user.id },
  });

  if (!doctor) {
    return { success: false, error: "Doctor profile not found." };
  }

  const { dateStr, publishNow } = parsed.data;
  const { start: dayStart, end: dayEnd } = getISTDayRangeUTC(dateStr);
  const now = new Date();

  try {
    const result = await db.$transaction(
      async (tx) => {
        // 1. Race-safe lock on the doctor row
        await tx.$executeRaw`SELECT id FROM doctors WHERE id = ${doctor.id} FOR UPDATE`;

        // 2. Fetch fresh doctor settings
        const currentDoc = await tx.doctor.findUniqueOrThrow({
          where: { id: doctor.id },
          include: { user: { select: { name: true } } },
        });

        const shouldPublish = publishNow || currentDoc.autoPublishWaves;

        // 3. Find and delete existing DRAFT waves for this doctor on this day
        const existingDraftWaves = await tx.wave.findMany({
          where: {
            doctorId: currentDoc.id,
            status: WaveStatus.DRAFT,
            windowStart: { gte: dayStart, lte: dayEnd },
          },
          select: { id: true },
        });

        const draftWaveIds = existingDraftWaves.map((w) => w.id);

        if (draftWaveIds.length > 0) {
          // Unassign appointments from draft waves (SetNull)
          await tx.appointment.updateMany({
            where: { waveId: { in: draftWaveIds } },
            data: { waveId: null },
          });

          // Delete the draft waves
          await tx.wave.deleteMany({
            where: { id: { in: draftWaveIds } },
          });
        }

        // 4. Fetch candidate appointments for this doctor on this date
        // Must be in active consultation statuses and NOT already in a PUBLISHED wave
        const eligibleAppointments = await tx.appointment.findMany({
          where: {
            availability: {
              doctorId: currentDoc.id,
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
            OR: [
              { waveId: null },
              { wave: { status: WaveStatus.DRAFT } },
            ],
          },
          include: {
            availability: true,
            patient: { select: { id: true, userId: true } },
          },
          orderBy: {
            availability: { startTime: "asc" },
          },
        });

        // 5. Run pure scheduling algorithm
        const schedule = generateDoctorWaveSchedule({
          appointments: eligibleAppointments.map((a) => ({
            id: a.id,
            patientId: a.patient.id,
            slotStartTime: a.availability.startTime,
            slotEndTime: a.availability.endTime,
            status: a.status,
            waveId: a.waveId,
          })),
          windowMinutes: currentDoc.waveWindowMinutes,
          capacity: currentDoc.waveCapacity,
          bufferMinutes: currentDoc.arrivalBufferMinutes,
          now,
        });

        // 6. Create waves and assign appointments
        const createdWaves: Array<{
          id: string;
          windowStart: Date;
          windowEnd: Date;
          userIds: string[];
        }> = [];

        for (const genWave of schedule.waves) {
          const newWave = await tx.wave.create({
            data: {
              doctorId: currentDoc.id,
              specialization: currentDoc.specialization,
              windowStart: genWave.windowStart,
              windowEnd: genWave.windowEnd,
              capacity: genWave.capacity,
              status: shouldPublish ? WaveStatus.PUBLISHED : WaveStatus.DRAFT,
              publishedAt: shouldPublish ? now : null,
              createdById: user.id,
            },
          });

          const apptIds = genWave.appointments.map((a) => a.id);
          if (apptIds.length > 0) {
            await tx.appointment.updateMany({
              where: { id: { in: apptIds } },
              data: { waveId: newWave.id },
            });
          }

          const userIds: string[] = [];
          for (const appt of eligibleAppointments) {
            if (apptIds.includes(appt.id)) {
              userIds.push(appt.patient.userId);
            }
          }

          createdWaves.push({
            id: newWave.id,
            windowStart: newWave.windowStart,
            windowEnd: newWave.windowEnd,
            userIds,
          });
        }

        // 7. If published, create deduplicated notifications
        if (shouldPublish) {
          for (const w of createdWaves) {
            const arrivalWindowText = formatWaveArrivalWindowIST(w.windowStart, w.windowEnd);
            for (const patientUserId of w.userIds) {
              const notifHref = `/patient/appointments?waveId=${w.id}`;
              const existingNotif = await tx.notification.findFirst({
                where: {
                  userId: patientUserId,
                  type: NotificationType.WAVE_PUBLISHED,
                  href: notifHref,
                },
              });

              if (!existingNotif) {
                await tx.notification.create({
                  data: {
                    userId: patientUserId,
                    type: NotificationType.WAVE_PUBLISHED,
                    title: "Consultation Arrival Window Assigned",
                    body: `Your consultation arrival window is ${arrivalWindowText}. Your consultation slot remains unchanged.`,
                    href: notifHref,
                  },
                });
              }
              const assigned = eligibleAppointments.find((appt) => appt.patient.userId === patientUserId);
              if (assigned) {
                await enqueuePatientNotifications(tx, {
                  userId: patientUserId,
                  appointmentId: assigned.id,
                  template: "booking_confirmed",
                  payload: {
                    doctorName: currentDoc.user.name ?? "Practitioner",
                    startTime: assigned.availability.startTime.toISOString(),
                    endTime: assigned.availability.endTime.toISOString(),
                    arrivalStartTime: new Date(w.windowStart).toISOString(),
                    arrivalEndTime: new Date(w.windowEnd).toISOString(),
                  },
                  dedupeKey: `email:arrival_window:${assigned.id}:${w.id}`,
                  whatsappTemplate: "arrival_window",
                  whatsappDedupeKey: `whatsapp:arrival_window:${assigned.id}:${w.id}`,
                });
              }
            }
          }
        }

        return {
          createdCount: createdWaves.length,
          unassignedCount: schedule.unassigned.length,
          unassignedReasons: schedule.unassigned.map((u) => ({
            id: u.appointment.id,
            reason: u.reason,
          })),
          isPublished: shouldPublish,
        };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    revalidatePath("/doctor/waves");
    revalidatePath("/doctor/queue");
    revalidatePath("/patient/appointments");

    const publishMsg = result.isPublished ? " (Published to patients)" : " (Draft)";
    return {
      success: true,
      message: `Generated ${result.createdCount} wave(s)${publishMsg}. ${result.unassignedCount} appointment(s) unassigned.`,
      ...result,
    };
  } catch (error) {
    console.error("[generateDoctorWavesAction] Error generating waves:", error);
    return { success: false, error: "Failed to generate waves." };
  }
}

/**
 * Creates a MANUAL wave window for a doctor.
 * Rule: Overlap validation applies to MANUAL wave creation only.
 */
export async function createDoctorManualWaveAction(input: CreateDoctorManualWaveInput) {
  const user = await requireRole(Role.DOCTOR);

  const parsed = createDoctorManualWaveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid wave parameters." };
  }

  const doctor = await db.doctor.findUnique({
    where: { userId: user.id },
  });

  if (!doctor) {
    return { success: false, error: "Doctor profile not found." };
  }

  const { dateStr, windowStartTime, windowEndTime, capacity, stream, notes } = parsed.data;
  const windowStart = parseISTDateTime(dateStr, windowStartTime);
  const windowEnd = parseISTDateTime(dateStr, windowEndTime);
  const { start: dayStart, end: dayEnd } = getISTDayRangeUTC(dateStr);

  try {
    // Check overlap with existing waves for this doctor on this day
    const existingWaves = await db.wave.findMany({
      where: {
        doctorId: doctor.id,
        windowStart: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true, windowStart: true, windowEnd: true },
    });

    const overlapCheck = validateManualWaveOverlap({ windowStart, windowEnd }, existingWaves);
    if (!overlapCheck.valid) {
      return { success: false, error: overlapCheck.error ?? "Manual wave overlaps with an existing wave." };
    }

    const wave = await db.wave.create({
      data: {
        doctorId: doctor.id,
        specialization: doctor.specialization,
        windowStart,
        windowEnd,
        capacity,
        stream: stream ?? null,
        status: WaveStatus.DRAFT,
        notes: notes ?? null,
        createdById: user.id,
      },
    });

    revalidatePath("/doctor/waves");
    return { success: true, waveId: wave.id, message: "Manual draft wave created successfully." };
  } catch (error) {
    console.error("[createDoctorManualWaveAction] Error:", error);
    return { success: false, error: "Failed to create manual wave." };
  }
}

/**
 * Publishes a DRAFT wave and notifies assigned patients with deduplication.
 */
export async function publishDoctorWaveAction(input: PublishDoctorWaveInput) {
  const user = await requireRole(Role.DOCTOR);

  const parsed = publishDoctorWaveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid parameters." };
  }

  const doctor = await db.doctor.findUnique({
    where: { userId: user.id },
  });

  if (!doctor) {
    return { success: false, error: "Doctor profile not found." };
  }

  const wave = await db.wave.findUnique({
    where: { id: parsed.data.waveId },
    include: {
      appointments: {
        include: { patient: { select: { userId: true } }, availability: true },
      },
    },
  });

  if (!wave || wave.doctorId !== doctor.id) {
    return { success: false, error: "Wave not found or unauthorized." };
  }

  if (wave.status !== WaveStatus.DRAFT) {
    return { success: false, error: `Wave is already ${wave.status}.` };
  }

  const now = new Date();

  try {
    await db.wave.update({
      where: { id: wave.id },
      data: {
        status: WaveStatus.PUBLISHED,
        publishedAt: now,
      },
    });

    // Notify assigned patients with deduplication
    const arrivalWindowText = formatWaveArrivalWindowIST(wave.windowStart, wave.windowEnd);
    for (const appt of wave.appointments) {
      const notifHref = `/patient/appointments?waveId=${wave.id}`;
      const existingNotif = await db.notification.findFirst({
        where: {
          userId: appt.patient.userId,
          type: NotificationType.WAVE_PUBLISHED,
          href: notifHref,
        },
      });

      if (!existingNotif) {
        await db.notification.create({
          data: {
            userId: appt.patient.userId,
            type: NotificationType.WAVE_PUBLISHED,
            title: "Consultation Arrival Window Assigned",
            body: `Your consultation arrival window is ${arrivalWindowText}. Your consultation slot remains unchanged.`,
            href: notifHref,
          },
        });
      }
      await enqueuePatientNotifications(db, {
        userId: appt.patient.userId,
        appointmentId: appt.id,
        template: "booking_confirmed",
        payload: {
          doctorName: "Practitioner",
          startTime: appt.availability.startTime.toISOString(),
          endTime: appt.availability.endTime.toISOString(),
          arrivalStartTime: wave.windowStart.toISOString(),
          arrivalEndTime: wave.windowEnd.toISOString(),
        },
        dedupeKey: `email:arrival_window:${appt.id}:${wave.id}`,
        whatsappTemplate: "arrival_window",
        whatsappDedupeKey: `whatsapp:arrival_window:${appt.id}:${wave.id}`,
      });
    }

    revalidatePath("/doctor/waves");
    revalidatePath(`/doctor/waves/${wave.id}`);
    revalidatePath("/doctor/queue");
    revalidatePath("/patient/appointments");

    return { success: true, message: "Wave successfully published to patients." };
  } catch (error) {
    console.error("[publishDoctorWaveAction] Error:", error);
    return { success: false, error: "Failed to publish wave." };
  }
}

/**
 * Reassigns or unassigns an appointment from a doctor's wave.
 */
export async function reassignDoctorWaveAppointmentAction(input: ReassignDoctorWaveAppointmentInput) {
  const user = await requireRole(Role.DOCTOR);

  const parsed = reassignDoctorWaveAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid parameters." };
  }

  const doctor = await db.doctor.findUnique({
    where: { userId: user.id },
  });

  if (!doctor) {
    return { success: false, error: "Doctor profile not found." };
  }

  const { appointmentId, targetWaveId } = parsed.data;

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: true,
      patient: { select: { userId: true } },
    },
  });

  if (!appointment || appointment.availability.doctorId !== doctor.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  if (targetWaveId === null) {
    // Unassign appointment from wave
    await db.appointment.update({
      where: { id: appointmentId },
      data: { waveId: null },
    });

    revalidatePath("/doctor/waves");
    return { success: true, message: "Appointment unassigned from wave." };
  }

  const targetWave = await db.wave.findUnique({
    where: { id: targetWaveId },
    include: {
      _count: { select: { appointments: true } },
    },
  });

  if (!targetWave || targetWave.doctorId !== doctor.id) {
    return { success: false, error: "Target wave not found or unauthorized." };
  }

  if (targetWave.status === WaveStatus.CLOSED) {
    return { success: false, error: "Cannot assign to a CLOSED wave." };
  }

  if (targetWave._count.appointments >= targetWave.capacity) {
    return {
      success: false,
      error: `Target wave is full (${targetWave._count.appointments}/${targetWave.capacity}).`,
    };
  }

  try {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { waveId: targetWaveId },
    });

    // If target wave is PUBLISHED, send notification to patient for the new window
    if (targetWave.status === WaveStatus.PUBLISHED) {
      const arrivalWindowText = formatWaveArrivalWindowIST(targetWave.windowStart, targetWave.windowEnd);
      const notifHref = `/patient/appointments?waveId=${targetWave.id}`;

      const existingNotif = await db.notification.findFirst({
        where: {
          userId: appointment.patient.userId,
          type: NotificationType.WAVE_PUBLISHED,
          href: notifHref,
        },
      });

      if (!existingNotif) {
        await db.notification.create({
          data: {
            userId: appointment.patient.userId,
            type: NotificationType.WAVE_PUBLISHED,
            title: "Consultation Arrival Window Updated",
            body: `Your arrival window has been updated to ${arrivalWindowText}. Your consultation slot remains unchanged.`,
            href: notifHref,
          },
        });
      }
    }

    revalidatePath("/doctor/waves");
    revalidatePath(`/doctor/waves/${targetWaveId}`);
    revalidatePath("/doctor/queue");
    revalidatePath("/patient/appointments");

    return { success: true, message: "Appointment successfully assigned to wave." };
  } catch (error) {
    console.error("[reassignDoctorWaveAppointmentAction] Error:", error);
    return { success: false, error: "Failed to reassign appointment." };
  }
}

/**
 * Deletes a DRAFT wave.
 * Published waves can never be deleted.
 */
export async function deleteDoctorDraftWaveAction(input: DeleteDoctorDraftWaveInput) {
  const user = await requireRole(Role.DOCTOR);

  const parsed = deleteDoctorDraftWaveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid parameters." };
  }

  const doctor = await db.doctor.findUnique({
    where: { userId: user.id },
  });

  if (!doctor) {
    return { success: false, error: "Doctor profile not found." };
  }

  const wave = await db.wave.findUnique({
    where: { id: parsed.data.waveId },
  });

  if (!wave || wave.doctorId !== doctor.id) {
    return { success: false, error: "Wave not found or unauthorized." };
  }

  if (wave.status !== WaveStatus.DRAFT) {
    return { success: false, error: "Only DRAFT waves can be deleted. Published waves are permanent." };
  }

  try {
    await db.$transaction(async (tx) => {
      // Unassign appointments (SetNull)
      await tx.appointment.updateMany({
        where: { waveId: wave.id },
        data: { waveId: null },
      });

      await tx.wave.delete({
        where: { id: wave.id },
      });
    });

    revalidatePath("/doctor/waves");
    return { success: true, message: "Draft wave deleted successfully." };
  } catch (error) {
    console.error("[deleteDoctorDraftWaveAction] Error deleting draft wave:", error);
    return { success: false, error: "Failed to delete draft wave." };
  }
}

// Retain legacy action signatures for backward-compatibility if referenced
export const createWaveAction = createDoctorManualWaveAction;
export const autoGenerateWavesAction = generateDoctorWavesAction;
export const reassignWaveAppointmentAction = reassignDoctorWaveAppointmentAction;
export const publishWaveAction = publishDoctorWaveAction;
