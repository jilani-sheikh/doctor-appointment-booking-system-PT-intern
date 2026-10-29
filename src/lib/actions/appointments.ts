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
  WaveStatus,
  VisitStream,
  Prisma,
} from "@/generated/prisma/client";
import { canPatientCancel } from "@/lib/appointment-status";
import { releaseSlot, notifyWaitlistAfterSlotRelease } from "@/lib/slots";
import { createNotification } from "@/lib/notifications";
import { formatDateTimeIST, formatDateIST, getISTDateString, getISTDayRangeUTC } from "@/lib/time";
import { formatWaveArrivalWindowIST } from "@/lib/waves";
import {
  MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT,
  MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY,
} from "@/lib/constants";
import { revalidatePath } from "next/cache";

/**
 * Books an appointment for a patient in a single atomic transaction.
 * Enforces:
 * - Patient authentication & completed patient profile
 * - Abuse guards: <= 3 active upcoming bookings per patient, <= 1 active booking per doctor per day
 * - Slot must be AVAILABLE and start > now + 1 hour
 * - Doctor must be APPROVED
 * - Never trusts client-supplied IDs
 * - Auto-confirms appointment immediately with status CONFIRMED
 * - Joins published wave if capacity remains and window has not passed
 * - Handles race conditions and catches partial unique index collisions (P2002)
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

  // Abuse guard 1: Limit patient to at most 3 active upcoming appointments (CONFIRMED/CHECKED_IN, slot in future)
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
        ],
      },
    },
  });

  if (activeUpcomingCount >= MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT) {
    return {
      success: false,
      error: `You already have ${activeUpcomingCount} active upcoming consultations (maximum allowed is ${MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT}). Please complete or cancel an existing consultation before booking a new one.`,
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

        return { appt, waveIdToAssign, assignedWaveArrivalWindow };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // Notifications dispatched post-commit (catch and log so failed notification never fails booking)
    const slotTimeFormatted = formatDateTimeIST(slot.startTime);
    const doctorName = slot.doctor.user.name ?? "Practitioner";
    const arrivalNote = appointment.assignedWaveArrivalWindow
      ? ` Arrival window: ${appointment.assignedWaveArrivalWindow}.`
      : "";

    try {
      // 1. Patient notification: APPOINTMENT_CONFIRMED
      await createNotification({
        userId: user.id,
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Your appointment is booked",
        body: `Your consultation with Dr. ${doctorName} on ${slotTimeFormatted} is confirmed.${arrivalNote}`,
        href: "/patient/appointments",
      });

      // 2. Doctor notification: GENERAL linking to /doctor/queue
      await createNotification({
        userId: slot.doctor.user.id,
        type: NotificationType.GENERAL,
        title: "New Booking Confirmed",
        body: `New booking: ${user.name ?? "Patient"}, ${slotTimeFormatted}`,
        href: "/doctor/queue",
      });
    } catch (notifError) {
      console.error("[bookAppointmentAction] Error sending post-commit notifications:", notifError);
    }

    // Cache revalidation for fresh queue, appointments, waves, and dashboard views
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
 *
 * Rules (Promt5.md & Amendment 2 & 4):
 * - Enforces canPatientCancel (PENDING or CONFIRMED, >= 2 hrs before start, or anytime if disrupted; never once CHECKED_IN).
 * - In a single transaction:
 *   (a) Updates appointment to CANCELLED with cancelledAt timestamp
 *   (b) Releases availability slot back using releaseSlot shared helper (checks DoctorTimeOff)
 * - Post-commit:
 *   - Notifies waitlist patients if slot returns to AVAILABLE
 *   - Creates APPOINTMENT_CANCELLED notifications for doctor and patient
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

  try {
    const result = await db.$transaction(
      async (tx) => {
        // 1. Mark appointment cancelled
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancelledAt: new Date(),
            waveId: null,
          },
        });

        // 2. Free availability slot using shared releaseSlot helper
        const slotRelease = await releaseSlot(tx, appointment.availabilityId);

        return { slotRelease };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    const slotTimeFormatted = formatDateTimeIST(appointment.availability.startTime);
    const doctorName = appointment.availability.doctor.user.name ?? "Practitioner";

    // Notify patient
    await createNotification({
      userId: user.id,
      type: NotificationType.APPOINTMENT_CANCELLED,
      title: "Appointment Cancelled",
      body: `Your consultation with Dr. ${doctorName} on ${slotTimeFormatted} has been cancelled.`,
      href: "/patient/appointments",
    });

    // Notify doctor
    await createNotification({
      userId: appointment.availability.doctor.user.id,
      type: NotificationType.APPOINTMENT_CANCELLED,
      title: "Patient Cancelled Appointment",
      body: `${user.name ?? "A patient"} has cancelled their consultation scheduled for ${slotTimeFormatted}. The slot is now freed.`,
      href: "/doctor/appointments",
    });

    // Notify waitlist if slot became AVAILABLE
    if (result.slotRelease.newlyAvailable) {
      await notifyWaitlistAfterSlotRelease(doctorId, result.slotRelease.startTime);
    }

    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath(`/doctors/${doctorId}`);

    return {
      success: true,
      message: "Appointment successfully cancelled and consultation slot freed.",
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
