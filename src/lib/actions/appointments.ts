"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookAppointmentSchema, type BookAppointmentInput } from "@/lib/validations/booking";
import {
  Role,
  DoctorStatus,
  SlotStatus,
  AppointmentStatus,
  NotificationType,
  PaymentStatus,
  RefundReason,
  WaveStatus,
  VisitStream,
  Prisma,
} from "@/generated/prisma/client";
import { canPatientCancel } from "@/lib/appointment-status";
import { releaseSlot, notifyWaitlistAfterSlotRelease } from "@/lib/slots";
import { createNotification } from "@/lib/notifications";
import { enqueueEmail } from "@/lib/notifications/index";
import { syncAppointmentReminders } from "@/lib/notifications/reminders";
import { formatDateIST, formatSlotDateTimeRangeIST, getISTDateString, getISTDayRangeUTC } from "@/lib/time";
import { formatWaveArrivalWindowIST } from "@/lib/waves";
import {
  MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT,
  MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY,
  MAX_SIMULTANEOUS_HOLDS_PER_PATIENT,
} from "@/lib/constants";
import { getPaymentsMode, isCashfreeConfigured } from "@/lib/env";
import { bookWithPaymentHold, requestRefund } from "@/lib/payments/service";
import { revalidatePath } from "next/cache";

/**
 * Books an appointment for a patient.
 *
 * Rules:
 * - Patient authentication & completed patient profile
 * - Abuse guards:
 *   1. <= 3 active upcoming bookings/holds per patient
 *   2. <= 1 active booking/hold per doctor per day (IST)
 *   3. <= 2 simultaneous PENDING_PAYMENT checkout holds per patient
 * - Slot must be AVAILABLE and start > now + 1 hour
 * - Doctor must be APPROVED
 * - When PAYMENTS_MODE === "cashfree" and fee > 0:
 *   Creates provisional hold (PENDING_PAYMENT) and initiates Cashfree order session.
 * - When PAYMENTS_MODE === "disabled" or fee === 0:
 *   Auto-confirms appointment immediately with status CONFIRMED directly.
 */
export async function bookAppointmentAction(input: BookAppointmentInput) {
  const user = await requireRole(Role.PATIENT);

  if (!user.patient) {
    return {
      success: false,
      error: "Please complete your patient onboarding profile before booking an appointment.",
    };
  }

  const parsed = bookAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.errors[0]?.message ?? "Invalid appointment parameters.",
    };
  }

  const { availabilityId, reason, stream } = parsed.data;
  const patientId = user.patient.id;
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  // Verify slot exists and doctor is approved
  const slot = await db.availability.findUnique({
    where: { id: availabilityId },
    include: {
      doctor: {
        select: {
          id: true,
          status: true,
          specialization: true,
          consultationFee: true,
          user: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!slot) {
    return { success: false, error: "The selected consultation slot could not be found." };
  }

  if (slot.doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Consultations can only be booked with approved practitioners." };
  }

  if (slot.startTime <= oneHourFromNow) {
    return {
      success: false,
      error: "Appointments must be booked at least 1 hour in advance.",
    };
  }

  // Abuse guard 1: Limit patient to at most 3 active upcoming appointments (CONFIRMED/CHECKED_IN/PENDING_PAYMENT, slot in future)
  const activeUpcomingCount = await db.appointment.count({
    where: {
      patientId,
      availability: {
        startTime: { gt: now },
      },
      status: {
        in: [
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.PENDING,
          AppointmentStatus.PENDING_PAYMENT,
        ],
      },
    },
  });

  if (activeUpcomingCount >= MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT) {
    return {
      success: false,
      error: `You already have ${activeUpcomingCount} active upcoming consultations or checkout holds (maximum allowed is ${MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT}). Please complete or cancel an existing consultation before booking a new one.`,
    };
  }

  // Abuse guard 2: Limit patient to at most 1 active booking per doctor per day (IST)
  const slotDateISTStr = getISTDateString(slot.startTime);
  const { start: dayStart, end: dayEnd } = getISTDayRangeUTC(slotDateISTStr);

  const existingDoctorBookingOnDay = await db.appointment.findFirst({
    where: {
      patientId,
      availability: {
        doctorId: slot.doctor.id,
        startTime: { gte: dayStart, lte: dayEnd },
      },
      status: {
        in: [
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.IN_CONSULTATION,
          AppointmentStatus.PENDING,
          AppointmentStatus.PENDING_PAYMENT,
        ],
      },
    },
  });

  if (existingDoctorBookingOnDay) {
    return {
      success: false,
      error: `You already have an active consultation booked with Dr. ${slot.doctor.user.name ?? "this practitioner"} on this date (${formatDateIST(slot.startTime)}). Patients are limited to ${MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY} active consultation per doctor per day.`,
    };
  }

  // Abuse guard 3: At most 2 simultaneous active checkout holds per patient
  const activeHoldsCount = await db.appointment.count({
    where: {
      patientId,
      status: AppointmentStatus.PENDING_PAYMENT,
      holdExpiresAt: { gt: now },
    },
  });

  if (activeHoldsCount >= MAX_SIMULTANEOUS_HOLDS_PER_PATIENT) {
    return {
      success: false,
      error: `You have reached the limit of ${MAX_SIMULTANEOUS_HOLDS_PER_PATIENT} active checkout holds. Please complete payment or cancel your pending hold before reserving another slot.`,
    };
  }

  const feeNumber = Number(slot.doctor.consultationFee);
  const paymentsMode = getPaymentsMode();

  // If online payments are required (mode === "cashfree" and fee > 0)
  if (paymentsMode === "cashfree" && feeNumber > 0) {
    if (!isCashfreeConfigured()) {
      console.error(
        "[bookAppointmentAction] Online payments are active (PAYMENTS_MODE=cashfree), but CASHFREE_KEY_ID or CASHFREE_SECRET is not configured."
      );
      return {
        success: false,
        error: "Online payments are not configured.",
      };
    }

    const holdResult = await bookWithPaymentHold({
      patientId,
      userId: user.id,
      patientName: user.name || "Patient",
      patientEmail: user.email,
      patientPhone: user.patient.phone,
      availabilityId,
      reason,
      stream,
    });

    if (!holdResult.success) {
      return {
        success: false,
        error: holdResult.error || "Unable to reserve slot for payment.",
      };
    }

    return {
      success: true,
      requiresPayment: true,
      orderId: holdResult.orderId,
      paymentSessionId: holdResult.paymentSessionId,
      appointmentId: holdResult.appointmentId,
      message: "Provisional hold created. Please complete payment.",
    };
  }

  // Fallback / Free flow: instant confirmation (disabled mode or fee == 0)
  try {
    const appointment = await db.$transaction(
      async (tx) => {
        // 1. Conditionally lock and mark slot as BOOKED
        const updatedSlot = await tx.availability.updateMany({
          where: {
            id: availabilityId,
            status: SlotStatus.AVAILABLE,
            startTime: { gt: oneHourFromNow },
          },
          data: {
            status: SlotStatus.BOOKED,
          },
        });

        if (updatedSlot.count !== 1) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        // 2. Wave assignment: join existing PUBLISHED wave of this doctor only if capacity remains and window has not passed
        const matchingWave = await tx.wave.findFirst({
          where: {
            OR: [
              { doctorId: slot.doctor.id },
              { doctorId: null, specialization: slot.doctor.specialization },
            ],
            status: WaveStatus.PUBLISHED,
            windowStart: { lte: slot.startTime },
            windowEnd: { gt: slot.startTime },
          },
          include: {
            _count: { select: { appointments: true } },
          },
        });

        let waveIdToAssign: string | null = null;
        let assignedWaveArrivalWindow: string | null = null;

        if (matchingWave && matchingWave._count.appointments < matchingWave.capacity) {
          waveIdToAssign = matchingWave.id;
          assignedWaveArrivalWindow = formatWaveArrivalWindowIST(
            matchingWave.windowStart,
            matchingWave.windowEnd
          );
        }

        // 3. Create Appointment record with status CONFIRMED directly
        const appt = await tx.appointment.create({
          data: {
            patientId,
            availabilityId,
            reason,
            stream: stream as VisitStream,
            status: AppointmentStatus.CONFIRMED,
            waveId: waveIdToAssign,
          },
        });

        // 4. Synchronize reminders inside transaction
        await syncAppointmentReminders(tx, {
          appointmentId: appt.id,
          userId: user.id,
          slotStartTime: slot.startTime,
          slotEndTime: slot.endTime,
          status: AppointmentStatus.CONFIRMED,
        });

        return { appt, waveIdToAssign, assignedWaveArrivalWindow };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // Notifications dispatched post-commit
    const slotTimeFormatted = formatSlotDateTimeRangeIST(slot.startTime, slot.endTime);
    const doctorName = slot.doctor.user.name ?? "Practitioner";
    const arrivalNote = appointment.assignedWaveArrivalWindow
      ? ` Arrival window: ${appointment.assignedWaveArrivalWindow} IST.`
      : "";

    try {
      await createNotification({
        userId: user.id,
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Your appointment is booked",
        body: `Your consultation with Dr. ${doctorName} on ${slotTimeFormatted} IST is confirmed.${arrivalNote}`,
        href: "/patient/appointments",
      });

      await createNotification({
        userId: slot.doctor.user.id,
        type: NotificationType.GENERAL,
        title: "New Booking Confirmed",
        body: `New booking: ${user.name ?? "Patient"}, ${slotTimeFormatted} IST`,
        href: "/doctor/queue",
      });

      await enqueueEmail(db, {
        userId: user.id,
        appointmentId: appointment.appt.id,
        template: "booking_confirmed",
        payload: {
          doctorName,
          specialization: slot.doctor.specialization,
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
          arrivalWindow: appointment.assignedWaveArrivalWindow,
        },
        dedupeKey: `email:booking_confirmed:${appointment.appt.id}`,
      });
    } catch (notifError) {
      console.error("[bookAppointmentAction] Error sending post-commit notifications:", notifError);
    }

    revalidatePath(`/doctors/${slot.doctorId}`);
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/waves");

    return {
      success: true,
      appointmentId: appointment.appt.id,
      message: "Your appointment is booked",
    };
  } catch (error) {
    if (
      (error instanceof Error && error.message === "SLOT_UNAVAILABLE") ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      return {
        success: false,
        error: "This slot is no longer available. Please select another consultation time.",
      };
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return {
          success: false,
          error: "The requested slot is no longer available. Please select another consultation time.",
        };
      }
      if (error.code === "P2028") {
        console.error("[Medrella Booking Action] Prisma transaction API error (P2028):", error);
        return {
          success: false,
          error: "The booking service timed out or was interrupted. Please try again in a moment.",
        };
      }
    }

    console.error("[Medrella Booking Action] Error booking appointment:", error);
    return {
      success: false,
      error: "An unexpected error occurred while booking the appointment. Please try again.",
    };
  }
}

/**
 * Cancels a patient's appointment.
 * Enforces cancellation window rules, frees slot using releaseSlot, and issues refund if paid.
 */
export async function cancelPatientAppointmentAction(appointmentId: string) {
  const user = await requireRole(Role.PATIENT);

  if (!user.patient) {
    return { success: false, error: "Patient profile not found." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: {
        include: {
          doctor: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
      },
      payments: {
        where: { status: PaymentStatus.PAID },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!appointment || appointment.patientId !== user.patient.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const cancelEval = canPatientCancel(
    {
      status: appointment.status,
      startTime: appointment.availability.startTime,
      disruptedAt: appointment.disruptedAt,
    },
    new Date()
  );

  if (!cancelEval.allowed) {
    return {
      success: false,
      error: cancelEval.reason ?? "Cancellation not allowed for this appointment.",
    };
  }

  const doctorId = appointment.availability.doctorId;
  const paidPayment = appointment.payments[0];

  try {
    const result = await db.$transaction(
      async (tx) => {
        // 1. Mark appointment cancelled
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledBy: "PATIENT",
            cancellationReason: "Cancelled by patient",
            waveId: null,
          },
        });

        // 2. Free availability slot using shared releaseSlot helper
        const slotRelease = await releaseSlot(tx, appointment.availabilityId);

        // 3. Sync reminders to cancelled
        await syncAppointmentReminders(tx, {
          appointmentId,
          userId: user.id,
          slotStartTime: appointment.availability.startTime,
          status: AppointmentStatus.CANCELLED,
        });

        return { slotRelease };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // 4. Handle refund if appointment had a paid payment
    let refundSummary: string | null = null;
    if (paidPayment) {
      const refundRes = await requestRefund({
        paymentId: paidPayment.id,
        appointmentId,
        reason: RefundReason.PATIENT_CANCELLED,
        note: "Patient initiated cancellation",
      });

      if (refundRes.amountRupees > 0) {
        refundSummary = `A refund of ₹${refundRes.amountRupees} has been initiated (${refundRes.status.toLowerCase()}).`;
      } else {
        refundSummary = "This cancellation was not eligible for a refund under policy terms.";
      }
    }

    const slotTimeFormatted = `${formatSlotDateTimeRangeIST(appointment.availability.startTime, appointment.availability.endTime)} IST`;
    const doctorName = appointment.availability.doctor.user.name ?? "Practitioner";

    // In-app Notifications
    await createNotification({
      userId: user.id,
      type: NotificationType.APPOINTMENT_CANCELLED,
      title: "Appointment Cancelled",
      body: `Your consultation with Dr. ${doctorName} on ${slotTimeFormatted} has been cancelled.${
        refundSummary ? ` ${refundSummary}` : ""
      }`,
      href: "/patient/appointments",
    });

    await createNotification({
      userId: appointment.availability.doctor.user.id,
      type: NotificationType.APPOINTMENT_CANCELLED,
      title: "Patient Cancelled Appointment",
      body: `${user.name ?? "A patient"} has cancelled their consultation scheduled for ${slotTimeFormatted}. The slot is now freed.`,
      href: "/doctor/appointments",
    });

    // Outbox email
    await enqueueEmail(db, {
      userId: user.id,
      appointmentId,
      template: "appointment_cancelled",
      payload: {
        doctorName,
        startTime: appointment.availability.startTime.toISOString(),
        endTime: appointment.availability.endTime.toISOString(),
        cancelledBy: "PATIENT",
        refundSummary,
      },
      dedupeKey: `email:appointment_cancelled:${appointmentId}`,
    });

    // Notify waitlist if slot became AVAILABLE
    if (result.slotRelease.newlyAvailable) {
      await notifyWaitlistAfterSlotRelease(doctorId, result.slotRelease.startTime);
    }

    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/patient/payments");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath(`/doctors/${doctorId}`);

    return {
      success: true,
      message: `Appointment successfully cancelled.${refundSummary ? ` ${refundSummary}` : ""}`,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return {
          success: false,
          error: "The appointment or slot could not be found.",
        };
      }
      if (error.code === "P2028") {
        console.error("[Medrella Cancel Action] Prisma transaction API error (P2028):", error);
        return {
          success: false,
          error: "Cancellation timed out or was interrupted. Please try again.",
        };
      }
    }

    console.error("[Medrella Cancel Action] Error cancelling appointment:", error);
    return {
      success: false,
      error: "Failed to cancel appointment. Please try again.",
    };
  }
}
