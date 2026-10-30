"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, DoctorStatus, SlotStatus, AppointmentStatus, NotificationType, Prisma } from "@/generated/prisma/client";
import { canPatientReschedule } from "@/lib/appointment-status";
import { releaseSlot, notifyWaitlistAfterSlotRelease } from "@/lib/slots";
import { createNotification } from "@/lib/notifications";
import { formatSlotDateTimeRangeIST } from "@/lib/time";
import {
  rescheduleAppointmentSchema,
  waitlistEntrySchema,
  type RescheduleAppointmentInput,
  type WaitlistEntryInput,
} from "@/lib/validations/reschedule";
import { enqueueEmail } from "@/lib/notifications/index";
import { syncAppointmentReminders } from "@/lib/notifications/reminders";
import { revalidatePath } from "next/cache";

/**
 * Reschedules an appointment to a new available slot with the same doctor.
 *
 * Transaction Safety:
 * In a single short interactive transaction:
 * (a) Locks and books new slot (must be AVAILABLE and > 1 hr in advance)
 * (b) Reassigns appointment, preserves CONFIRMED status, clears waveId, increments rescheduleCount
 * (c) Releases old slot back to AVAILABLE using shared releaseSlot helper
 * Post-commit:
 * Dispatches notifications to doctor, patient, and waitlist for the freed slot.
 */
export async function patientRescheduleAppointmentAction(input: RescheduleAppointmentInput) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    return { success: false, error: "Patient profile not found." };
  }

  const parsed = rescheduleAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid parameters." };
  }

  const { appointmentId, newAvailabilityId } = parsed.data;
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: {
        include: {
          doctor: {
            include: { user: { select: { name: true, id: true } } },
          },
        },
      },
    },
  });

  if (!appointment || appointment.patientId !== user.patient.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const rescheduleEval = canPatientReschedule(
    {
      status: appointment.status,
      startTime: appointment.availability.startTime,
      rescheduleCount: appointment.rescheduleCount,
      disruptedAt: appointment.disruptedAt,
    },
    now
  );

  if (!rescheduleEval.allowed) {
    return { success: false, error: rescheduleEval.reason ?? "Reschedule not allowed." };
  }

  const oldAvailabilityId = appointment.availabilityId;
  const doctorId = appointment.availability.doctorId;

  // Verify new slot belongs to the same doctor
  const newSlot = await db.availability.findUnique({
    where: { id: newAvailabilityId },
  });

  if (!newSlot || newSlot.doctorId !== doctorId) {
    return { success: false, error: "The selected slot must belong to the same doctor." };
  }

  if (newSlot.status !== SlotStatus.AVAILABLE || newSlot.startTime <= oneHourFromNow) {
    return { success: false, error: "The selected slot is not available or starts within 1 hour." };
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        // (a) Atomically book the new slot
        const bookNew = await tx.availability.updateMany({
          where: {
            id: newAvailabilityId,
            status: SlotStatus.AVAILABLE,
            startTime: { gt: oneHourFromNow },
          },
          data: { status: SlotStatus.BOOKED },
        });

        if (bookNew.count !== 1) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        // (b) Update appointment (stays CONFIRMED, clears waveId, increments rescheduleCount)
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            availabilityId: newAvailabilityId,
            rescheduledFromAvailabilityId: oldAvailabilityId,
            rescheduleCount: { increment: 1 },
            waveId: null, // Clear wave assignment
            disruptedAt: null, // Disruption resolved by rescheduling
            disruptionReason: null,
          },
        });

        // (c) Free the old slot using shared releaseSlot helper
        const oldRelease = await releaseSlot(tx, oldAvailabilityId);

        // (d) Synchronize reminders for new slot time
        await syncAppointmentReminders(tx, {
          appointmentId,
          userId: user.id,
          slotStartTime: newSlot.startTime,
          slotEndTime: newSlot.endTime,
          status: AppointmentStatus.CONFIRMED,
        });

        return { oldRelease };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // Post-commit: trigger notifications
    const newSlotTimeFormatted = formatSlotDateTimeRangeIST(newSlot.startTime, newSlot.endTime);
    const doctorName = appointment.availability.doctor.user.name ?? "Practitioner";

    // Notify patient
    await createNotification({
      userId: user.id,
      type: NotificationType.APPOINTMENT_RESCHEDULED,
      title: "Appointment Rescheduled",
      body: `Your consultation with Dr. ${doctorName} has been rescheduled to ${newSlotTimeFormatted}.`,
      href: "/patient/appointments",
    });

    // Enqueue outbox email
    await enqueueEmail(db, {
      userId: user.id,
      appointmentId,
      template: "appointment_rescheduled",
      payload: {
        doctorName,
        oldStartTime: appointment.availability.startTime.toISOString(),
        oldEndTime: appointment.availability.endTime.toISOString(),
        newStartTime: newSlot.startTime.toISOString(),
        newEndTime: newSlot.endTime.toISOString(),
      },
      dedupeKey: `email:rescheduled:${appointmentId}:${newSlot.startTime.getTime()}`,
    });

    // Notify doctor
    await createNotification({
      userId: appointment.availability.doctor.user.id,
      type: NotificationType.APPOINTMENT_RESCHEDULED,
      title: "Patient Rescheduled Consultation",
      body: `${user.name ?? "A patient"} has rescheduled their consultation to ${newSlotTimeFormatted}.`,
      href: "/doctor/appointments",
    });

    // Notify waitlist if old slot is newly available
    if (result.oldRelease.newlyAvailable) {
      await notifyWaitlistAfterSlotRelease(doctorId, result.oldRelease.startTime);
    }

    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/waves");
    revalidatePath(`/doctors/${doctorId}`);

    return {
      success: true,
      message: `Appointment successfully rescheduled to ${newSlotTimeFormatted}!`,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_UNAVAILABLE") {
      return { success: false, error: "The chosen slot was just taken. Please choose another." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: "The chosen slot is no longer available." };
    }
    console.error("[patientRescheduleAppointmentAction] Error:", error);
    return { success: false, error: "Failed to reschedule appointment. Please try again." };
  }
}

/**
 * Doctor reschedule action with a reason.
 */
export async function doctorRescheduleAppointmentAction(input: RescheduleAppointmentInput) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can reschedule consultations." };
  }

  const parsed = rescheduleAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid parameters." };
  }

  const { appointmentId, newAvailabilityId, reason } = parsed.data;

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: true,
      patient: { select: { userId: true, user: { select: { name: true } } } },
    },
  });

  if (!appointment || appointment.availability.doctorId !== doctor.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const oldAvailabilityId = appointment.availabilityId;

  // New slot check
  const newSlot = await db.availability.findUnique({
    where: { id: newAvailabilityId },
  });

  if (!newSlot || newSlot.doctorId !== doctor.id || newSlot.status !== SlotStatus.AVAILABLE) {
    return { success: false, error: "The selected slot is not available." };
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        const bookNew = await tx.availability.updateMany({
          where: {
            id: newAvailabilityId,
            status: SlotStatus.AVAILABLE,
          },
          data: { status: SlotStatus.BOOKED },
        });

        if (bookNew.count !== 1) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            availabilityId: newAvailabilityId,
            rescheduledFromAvailabilityId: oldAvailabilityId,
            rescheduleCount: { increment: 1 },
            waveId: null,
            status: AppointmentStatus.CONFIRMED, // Confirmed by doctor
          },
        });

        const oldRelease = await releaseSlot(tx, oldAvailabilityId);
        return { oldRelease };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    const newSlotTimeFormatted = formatSlotDateTimeRangeIST(newSlot.startTime, newSlot.endTime);
    const doctorName = user.name ?? "Practitioner";

    // Notify patient
    await createNotification({
      userId: appointment.patient.userId,
      type: NotificationType.APPOINTMENT_RESCHEDULED,
      title: "Doctor Rescheduled Your Consultation",
      body: `Dr. ${doctorName} has rescheduled your consultation to ${newSlotTimeFormatted}.${
        reason ? ` Reason: ${reason}` : ""
      }`,
      href: "/patient/appointments",
    });

    if (result.oldRelease.newlyAvailable) {
      await notifyWaitlistAfterSlotRelease(doctor.id, result.oldRelease.startTime);
    }

    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/queue");
    revalidatePath("/patient/appointments");
    revalidatePath(`/doctors/${doctor.id}`);

    return {
      success: true,
      message: `Appointment rescheduled to ${newSlotTimeFormatted}. Patient notified.`,
    };
  } catch (error) {
    console.error("[doctorRescheduleAppointmentAction] Error:", error);
    return { success: false, error: "Failed to reschedule appointment." };
  }
}

/**
 * Adds patient to doctor's waitlist for newly available slots.
 */
export async function joinWaitlistAction(input: WaitlistEntryInput) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    return { success: false, error: "Please complete patient onboarding first." };
  }

  const parsed = waitlistEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid parameters." };
  }

  const { doctorId, earliestDate, latestDate } = parsed.data;

  try {
    await db.waitlistEntry.upsert({
      where: {
        patientId_doctorId: {
          patientId: user.patient.id,
          doctorId,
        },
      },
      update: {
        earliestDate: new Date(earliestDate),
        latestDate: new Date(latestDate),
        notifiedAt: null, // Reset notification status
      },
      create: {
        patientId: user.patient.id,
        doctorId,
        earliestDate: new Date(earliestDate),
        latestDate: new Date(latestDate),
      },
    });

    revalidatePath(`/doctors/${doctorId}`);

    return {
      success: true,
      message: "You have joined the waitlist! We will notify you when a consultation slot opens up.",
    };
  } catch (error) {
    console.error("[joinWaitlistAction] Error:", error);
    return { success: false, error: "Failed to join waitlist. Please try again." };
  }
}

/**
 * Removes patient from doctor's waitlist.
 */
export async function leaveWaitlistAction(doctorId: string) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    return { success: false, error: "Patient profile not found." };
  }

  try {
    await db.waitlistEntry.deleteMany({
      where: {
        patientId: user.patient.id,
        doctorId,
      },
    });

    revalidatePath(`/doctors/${doctorId}`);

    return { success: true, message: "You have been removed from the waitlist." };
  } catch (error) {
    console.error("[leaveWaitlistAction] Error:", error);
    return { success: false, error: "Failed to remove from waitlist." };
  }
}
