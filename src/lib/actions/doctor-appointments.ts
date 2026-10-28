"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, DoctorStatus, AppointmentStatus, SlotStatus, Prisma } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";

type AllowedDoctorTransition = "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

/**
 * Updates an appointment's status according to the clinical transition rules.
 * Enforces:
 * - Approved doctor authorization
 * - Strict doctor ownership check
 * - Valid transition matrix:
 *   - PENDING -> CONFIRMED, CANCELLED
 *   - CONFIRMED -> COMPLETED, NO_SHOW (only after start time), CANCELLED
 *   - CANCELLED -> frees slot to AVAILABLE in a single atomic transaction
 *   - COMPLETED / NO_SHOW / CANCELLED are terminal/final
 */
export async function updateDoctorAppointmentStatusAction(
  appointmentId: string,
  targetStatus: AllowedDoctorTransition
) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can manage consultations." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: true,
    },
  });

  if (!appointment || appointment.availability.doctorId !== doctor.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const current = appointment.status;
  const now = new Date();

  // Terminal state check
  if (
    current === AppointmentStatus.COMPLETED ||
    current === AppointmentStatus.CANCELLED ||
    current === AppointmentStatus.NO_SHOW
  ) {
    return {
      success: false,
      error: `Appointment is already in ${current.toLowerCase()} status and cannot be changed.`,
    };
  }

  // Validate state transitions
  if (current === AppointmentStatus.PENDING) {
    if (targetStatus !== "CONFIRMED" && targetStatus !== "CANCELLED") {
      return {
        success: false,
        error: `Pending appointments can only be confirmed or cancelled. Received: ${targetStatus}.`,
      };
    }
  } else if (current === AppointmentStatus.CONFIRMED) {
    if (targetStatus === "NO_SHOW") {
      if (now < appointment.availability.startTime) {
        return {
          success: false,
          error: "No-Show can only be recorded after the consultation scheduled start time has passed.",
        };
      }
    } else if (targetStatus !== "COMPLETED" && targetStatus !== "CANCELLED") {
      return {
        success: false,
        error: `Confirmed appointments can only transition to Completed, No-Show, or Cancelled.`,
      };
    }
  }

  try {
    if (targetStatus === "CANCELLED") {
      // In a single atomic transaction: mark appointment cancelled and free slot back to AVAILABLE
      await db.$transaction(
        async (tx) => {
          await tx.appointment.update({
            where: { id: appointmentId },
            data: {
              status: AppointmentStatus.CANCELLED,
              cancelledAt: new Date(),
            },
          });

          await tx.availability.update({
            where: { id: appointment.availabilityId },
            data: {
              status: SlotStatus.AVAILABLE,
            },
          });
        },
        { maxWait: 10000, timeout: 20000 }
      );
    } else {
      await db.appointment.update({
        where: { id: appointmentId },
        data: {
          status: targetStatus as AppointmentStatus,
        },
      });
    }

    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath(`/doctors/${doctor.id}`);

    return {
      success: true,
      message: `Appointment status updated to ${targetStatus.toLowerCase()}.`,
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
        console.error("[Medrella Doctor Status Update] Prisma transaction API error (P2028):", error);
        return {
          success: false,
          error: "Operation timed out or connection was interrupted. Please try again.",
        };
      }
    }

    console.error("[Medrella Doctor Status Update] Error:", error);
    return {
      success: false,
      error: "Failed to update appointment status. Please try again.",
    };
  }
}
