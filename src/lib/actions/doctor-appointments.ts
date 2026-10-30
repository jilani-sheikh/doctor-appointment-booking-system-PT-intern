"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  Role,
  AppointmentStatus,
  NotificationType,
  PaymentStatus,
  RefundReason,
} from "@/generated/prisma/client";
import {
  isValidTransition,
  canDoctorNoShow,
} from "@/lib/appointment-status";
import { releaseSlot, notifyWaitlistAfterSlotRelease } from "@/lib/slots";
import { createNotification } from "@/lib/notifications";
import { enqueueEmail } from "@/lib/notifications/index";
import { syncAppointmentReminders } from "@/lib/notifications/reminders";
import { requestRefund } from "@/lib/payments/service";
import { formatSlotDateTimeRangeIST } from "@/lib/time";
import { revalidatePath } from "next/cache";

/**
 * Transitions appointment status for doctor workflows.
 *
 * Enforces:
 * - Doctor authentication and ownership of the appointment
 * - State machine validity via isValidTransition
 * - Timing constraint for NO_SHOW via canDoctorNoShow (>= 15 mins after start)
 * - Releases slots using shared releaseSlot helper on cancellation
 * - Triggers 100% refund if a payment was attached
 * - Synchronizes reminders and sends patient notifications
 */
export async function updateDoctorAppointmentStatusAction(
  appointmentId: string,
  targetStatus: "CANCELLED" | "COMPLETED" | "NO_SHOW"
) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor) {
    return { success: false, error: "Doctor profile not found." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: true,
      patient: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      payments: {
        where: { status: PaymentStatus.PAID },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!appointment || appointment.availability.doctorId !== doctor.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const now = new Date();
  const current = appointment.status;

  // Validate state machine transition
  if (!isValidTransition(current, targetStatus, Role.DOCTOR)) {
    return {
      success: false,
      error: `Transition from ${current} to ${targetStatus} is not permitted for doctor role.`,
    };
  }

  // Timing check for No-Show
  if (targetStatus === "NO_SHOW") {
    const noShowEval = canDoctorNoShow(
      { status: current, startTime: appointment.availability.startTime },
      now
    );
    if (!noShowEval.allowed) {
      return { success: false, error: noShowEval.reason ?? "Cannot mark No-Show at this time." };
    }
  }

  try {
    let newlyFreedSlot = false;
    let freedSlotStartTime: Date = appointment.availability.startTime;
    let refundSummary: string | null = null;

    if (targetStatus === "CANCELLED") {
      // In a transaction: mark cancelled, clear waveId, free slot, sync reminders
      await db.$transaction(
        async (tx) => {
          await tx.appointment.update({
            where: { id: appointmentId },
            data: {
              status: AppointmentStatus.CANCELLED,
              cancelledAt: now,
              cancelledBy: "DOCTOR",
              cancellationReason: "Cancelled by practitioner",
              waveId: null,
            },
          });

          const release = await releaseSlot(tx, appointment.availabilityId);
          newlyFreedSlot = release.newlyAvailable;
          freedSlotStartTime = release.startTime;

          await syncAppointmentReminders(tx, {
            appointmentId,
            userId: appointment.patient.userId,
            slotStartTime: appointment.availability.startTime,
            status: AppointmentStatus.CANCELLED,
          });
        },
        { maxWait: 10000, timeout: 20000 }
      );

      // Refund 100% for doctor cancellations
      const paidPayment = appointment.payments[0];
      if (paidPayment) {
        const refundRes = await requestRefund({
          paymentId: paidPayment.id,
          appointmentId,
          reason: RefundReason.DOCTOR_CANCELLED,
          note: "Doctor cancelled appointment - 100% full refund issued",
        });

        if (refundRes.amountRupees > 0) {
          refundSummary = `A full refund of ₹${refundRes.amountRupees} has been initiated to your original payment method.`;
        }
      }

      // Notify patient of doctor cancellation
      const slotTimeFormatted = `${formatSlotDateTimeRangeIST(appointment.availability.startTime, appointment.availability.endTime)} IST`;
      await createNotification({
        userId: appointment.patient.userId,
        type: NotificationType.APPOINTMENT_CANCELLED,
        title: "Appointment Cancelled by Practitioner",
        body: `Dr. ${user.name ?? "Your doctor"} has cancelled your consultation scheduled for ${slotTimeFormatted}.${
          refundSummary ? ` ${refundSummary}` : ""
        }`,
        href: "/patient/appointments",
      });

      // Outbox email
      await enqueueEmail(db, {
        userId: appointment.patient.userId,
        appointmentId,
        template: "appointment_cancelled",
        payload: {
          doctorName: user.name || "Doctor",
          startTime: appointment.availability.startTime.toISOString(),
          endTime: appointment.availability.endTime.toISOString(),
          cancelledBy: "DOCTOR",
          refundSummary,
        },
        dedupeKey: `email:doctor_cancelled:${appointmentId}`,
      });

      // Notify waitlist if slot became available
      if (newlyFreedSlot) {
        await notifyWaitlistAfterSlotRelease(doctor.id, freedSlotStartTime);
      }
    } else if (targetStatus === "COMPLETED") {
      await db.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            status: AppointmentStatus.COMPLETED,
            actualEndAt: now,
          },
        });

        await syncAppointmentReminders(tx, {
          appointmentId,
          userId: appointment.patient.userId,
          slotStartTime: appointment.availability.startTime,
          status: AppointmentStatus.COMPLETED,
        });
      });
    } else if (targetStatus === "NO_SHOW") {
      await db.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            status: AppointmentStatus.NO_SHOW,
          },
        });

        await syncAppointmentReminders(tx, {
          appointmentId,
          userId: appointment.patient.userId,
          slotStartTime: appointment.availability.startTime,
          status: AppointmentStatus.NO_SHOW,
        });
      });
    }

    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/patient/payments");

    return {
      success: true,
      message: `Appointment marked as ${targetStatus.toLowerCase()}.${refundSummary ? ` ${refundSummary}` : ""}`,
    };
  } catch (error) {
    console.error("[updateDoctorAppointmentStatusAction] Error updating status:", error);
    return {
      success: false,
      error: "Failed to update appointment status. Please try again.",
    };
  }
}
