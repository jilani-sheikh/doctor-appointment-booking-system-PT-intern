"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, DoctorStatus, SlotStatus, AppointmentStatus, NotificationType } from "@/generated/prisma/client";
import { notifyWaitlistAfterSlotRelease } from "@/lib/slots";
import { createManyNotifications } from "@/lib/notifications";
import { formatDateTimeIST } from "@/lib/time";
import {
  doctorTimeOffSchema,
  deleteDoctorTimeOffSchema,
  type DoctorTimeOffInput,
  type DeleteDoctorTimeOffInput,
} from "@/lib/validations/time-off";
import { revalidatePath } from "next/cache";

/**
 * Creates a doctor absence record and applies cascading schedule disruption.
 *
 * Rules (Promt5.md & Amendments 1 & 2):
 * 1. Sets AVAILABLE slots in the range to BLOCKED and records blockedByTimeOffId.
 * 2. Marks affected active appointments (PENDING/CONFIRMED) as disrupted with disruptedAt & disruptionReason (does NOT auto-cancel).
 * 3. Creates DOCTOR_ABSENCE notifications for each affected patient with a link to reschedule.
 * Uses batched updates and array-form operations.
 */
export async function createDoctorTimeOffAction(input: DoctorTimeOffInput) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can record time off." };
  }

  const parsed = doctorTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid time-off parameters." };
  }

  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);
  const reason = parsed.data.reason ?? "Doctor unavailable";
  const now = new Date();

  if (endAt <= now) {
    return { success: false, error: "Absence time cannot be entirely in the past." };
  }

  try {
    // 1. Create the DoctorTimeOff record
    const timeOff = await db.doctorTimeOff.create({
      data: {
        doctorId: doctor.id,
        startAt,
        endAt,
        reason,
      },
    });

    // 2. Block all unbooked AVAILABLE slots falling within this absence window
    await db.availability.updateMany({
      where: {
        doctorId: doctor.id,
        status: SlotStatus.AVAILABLE,
        startTime: { lt: endAt },
        endTime: { gt: startAt },
      },
      data: {
        status: SlotStatus.BLOCKED,
        blockedByTimeOffId: timeOff.id,
      },
    });

    // 3. Find and mark affected active appointments as disrupted
    const affectedAppointments = await db.appointment.findMany({
      where: {
        availability: {
          doctorId: doctor.id,
          startTime: { lt: endAt },
          endTime: { gt: startAt },
        },
        status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      },
      include: {
        patient: { select: { userId: true } },
        availability: { select: { startTime: true } },
      },
    });

    if (affectedAppointments.length > 0) {
      await db.appointment.updateMany({
        where: {
          id: { in: affectedAppointments.map((a) => a.id) },
        },
        data: {
          disruptedAt: now,
          disruptionReason: reason,
        },
      });

      // 4. Create in-app DOCTOR_ABSENCE notifications for affected patients
      const doctorName = user.name ?? "Practitioner";
      await createManyNotifications(
        affectedAppointments.map((appt) => ({
          userId: appt.patient.userId,
          type: NotificationType.DOCTOR_ABSENCE,
          title: "Doctor Unavailable — Schedule Disruption",
          body: `Dr. ${doctorName} is unavailable during your scheduled consultation on ${formatDateTimeIST(
            appt.availability.startTime
          )}. Please reschedule your appointment.`,
          href: "/patient/appointments",
        }))
      );
    }

    revalidatePath("/doctor/time-off");
    revalidatePath("/doctor/slots");
    revalidatePath("/doctor/appointments");
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath(`/doctors/${doctor.id}`);

    return {
      success: true,
      message: `Time off saved. ${affectedAppointments.length} patient consultation(s) marked as disrupted and notified.`,
    };
  } catch (error) {
    console.error("[createDoctorTimeOffAction] Error:", error);
    return { success: false, error: "Failed to record doctor time off." };
  }
}

/**
 * Deletes a future doctor absence and restores affected unbooked slots.
 *
 * Rule (Promt5.md Amendment 1):
 * Restores ONLY slots with blockedByTimeOffId = timeOff.id that have no active appointment.
 * Never touches manually blocked slots (which have blockedByTimeOffId = null).
 */
export async function deleteDoctorTimeOffAction(input: DeleteDoctorTimeOffInput) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can manage time off." };
  }

  const parsed = deleteDoctorTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid time-off ID." };
  }

  const timeOff = await db.doctorTimeOff.findUnique({
    where: { id: parsed.data.id },
  });

  if (!timeOff || timeOff.doctorId !== doctor.id) {
    return { success: false, error: "Absence record not found or unauthorized." };
  }

  try {
    // Find candidate slots blocked by this time-off that have no active appointment
    const blockedSlots = await db.availability.findMany({
      where: {
        doctorId: doctor.id,
        blockedByTimeOffId: timeOff.id,
        status: SlotStatus.BLOCKED,
        appointments: {
          none: {
            status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION] },
          },
        },
      },
      select: { id: true, startTime: true },
    });

    // 1. Delete the time-off record (Availability.blockedByTimeOffId set null on delete)
    await db.doctorTimeOff.delete({
      where: { id: timeOff.id },
    });

    // 2. Restore slots that were blocked specifically by this absence
    if (blockedSlots.length > 0) {
      await db.availability.updateMany({
        where: {
          id: { in: blockedSlots.map((s) => s.id) },
        },
        data: {
          status: SlotStatus.AVAILABLE,
          blockedByTimeOffId: null,
        },
      });

      // 3. Notify waitlist for the newly available slots
      for (const slot of blockedSlots) {
        await notifyWaitlistAfterSlotRelease(doctor.id, slot.startTime);
      }
    }

    revalidatePath("/doctor/time-off");
    revalidatePath("/doctor/slots");
    revalidatePath(`/doctors/${doctor.id}`);

    return {
      success: true,
      message: `Absence removed. Restored ${blockedSlots.length} consultation slot(s) back to Available.`,
    };
  } catch (error) {
    console.error("[deleteDoctorTimeOffAction] Error:", error);
    return { success: false, error: "Failed to delete absence record." };
  }
}
