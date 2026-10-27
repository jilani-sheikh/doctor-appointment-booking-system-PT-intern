"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookAppointmentSchema, type BookAppointmentInput } from "@/lib/validations/booking";
import { Role, DoctorStatus, SlotStatus, AppointmentStatus, Prisma } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";

/**
 * Books an appointment for a patient in a single atomic transaction.
 * Enforces:
 * - Patient authentication & completed patient profile
 * - Slot must be AVAILABLE and start > now + 1 hour
 * - Doctor must be APPROVED
 * - Never trusts client-supplied IDs
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

  const { availabilityId, reason } = parsed.data;
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

  try {
    const appointment = await db.$transaction(async (tx) => {
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

      // 2. Create Appointment record
      const appt = await tx.appointment.create({
        data: {
          patientId,
          availabilityId,
          reason,
          status: AppointmentStatus.PENDING,
        },
      });

      return appt;
    });

    revalidatePath(`/doctors/${slot.doctorId}`);
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");

    return {
      success: true,
      appointmentId: appointment.id,
      message: "Appointment successfully booked! Awaiting doctor confirmation.",
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

    console.error("[Medrella Booking Action] Error booking appointment:", error);
    return {
      success: false,
      error: "An unexpected error occurred while booking the appointment. Please try again.",
    };
  }
}

/**
 * Cancels a patient's appointment if it is PENDING or CONFIRMED and at least 2 hours before start time.
 * In a single transaction:
 * - Updates appointment status to CANCELLED with cancelledAt timestamp
 * - Frees the slot back to AVAILABLE
 */
export async function cancelPatientAppointmentAction(appointmentId: string) {
  const user = await requireRole(Role.PATIENT);

  if (!user.patient) {
    return { success: false, error: "Patient profile not found." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: true,
    },
  });

  if (!appointment || appointment.patientId !== user.patient.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  if (
    appointment.status !== AppointmentStatus.PENDING &&
    appointment.status !== AppointmentStatus.CONFIRMED
  ) {
    return {
      success: false,
      error: `Appointments in ${appointment.status.toLowerCase()} status cannot be cancelled.`,
    };
  }

  const now = new Date();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  if (appointment.availability.startTime <= twoHoursFromNow) {
    return {
      success: false,
      error: "Appointments can only be cancelled at least 2 hours before the consultation time.",
    };
  }

  try {
    await db.$transaction(async (tx) => {
      // 1. Mark appointment cancelled
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });

      // 2. Free availability slot back to AVAILABLE
      await tx.availability.update({
        where: { id: appointment.availabilityId },
        data: {
          status: SlotStatus.AVAILABLE,
        },
      });
    });

    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath(`/doctors/${appointment.availability.doctorId}`);

    return {
      success: true,
      message: "Appointment successfully cancelled and consultation slot freed.",
    };
  } catch (error) {
    console.error("[Medrella Cancel Action] Error cancelling appointment:", error);
    return {
      success: false,
      error: "Failed to cancel appointment. Please try again.",
    };
  }
}
