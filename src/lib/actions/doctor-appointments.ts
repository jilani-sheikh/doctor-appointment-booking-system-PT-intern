"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  Role,
  DoctorStatus,
  AppointmentStatus,
  NotificationType,
  WaveStatus,
  Prisma,
} from "@/generated/prisma/client";
import {
  canDoctorNoShow,
  isValidTransition,
  isTerminalStatus,
} from "@/lib/appointment-status";
import { releaseSlot, notifyWaitlistAfterSlotRelease } from "@/lib/slots";
import { createNotification } from "@/lib/notifications";
import { formatDateTimeIST } from "@/lib/time";
import { formatWaveArrivalWindowIST } from "@/lib/waves";
import { revalidatePath } from "next/cache";

type AllowedDoctorTransition = "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

/**
 * Updates an appointment's status according to the clinical transition rules.
 * Enforces:
 * - Approved doctor authorization
 * - Strict doctor ownership check
 * - Valid transition matrix via single source of truth (lib/appointment-status.ts)
 * - Releases slots using shared releaseSlot helper on cancellation
 * - Triggers APPOINTMENT_CONFIRMED / APPOINTMENT_CANCELLED notifications
 * - Handles late additions to published waves when capacity remains (Amendment 5b)
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
      patient: { select: { userId: true, user: { select: { name: true } } } },
    },
  });

  if (!appointment || appointment.availability.doctorId !== doctor.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const current = appointment.status;
  const now = new Date();

  // Terminal state check
  if (isTerminalStatus(current)) {
    return {
      success: false,
      error: `Appointment is already in ${current.toLowerCase()} status and cannot be changed.`,
    };
  }

  // Validate state transitions via centralized domain rules
  if (!isValidTransition(current, targetStatus as AppointmentStatus, Role.DOCTOR)) {
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
    let assignedWaveArrivalWindow: string | null = null;

    if (targetStatus === "CANCELLED") {
      // In a transaction: mark cancelled and free slot using releaseSlot helper
      await db.$transaction(
        async (tx) => {
          await tx.appointment.update({
            where: { id: appointmentId },
            data: {
              status: AppointmentStatus.CANCELLED,
              cancelledAt: now,
            },
          });

          const release = await releaseSlot(tx, appointment.availabilityId);
          newlyFreedSlot = release.newlyAvailable;
          freedSlotStartTime = release.startTime;
        },
        { maxWait: 10000, timeout: 20000 }
      );

      // Notify patient of doctor cancellation
      const slotTimeFormatted = formatDateTimeIST(appointment.availability.startTime);
      await createNotification({
        userId: appointment.patient.userId,
        type: NotificationType.APPOINTMENT_CANCELLED,
        title: "Appointment Cancelled by Practitioner",
        body: `Dr. ${user.name ?? "Your doctor"} has cancelled your consultation scheduled for ${slotTimeFormatted}.`,
        href: "/patient/appointments",
      });

      // Notify waitlist if slot became available
      if (newlyFreedSlot) {
        await notifyWaitlistAfterSlotRelease(doctor.id, freedSlotStartTime);
      }
    } else if (targetStatus === "CONFIRMED") {
      // Late addition to wave check (Amendment 5b):
      // If a published wave exists for this specialization and time window, and has capacity remaining, assign it!
      const matchingWave = await db.wave.findFirst({
        where: {
          specialization: doctor.specialization,
          status: WaveStatus.PUBLISHED,
          windowStart: { lte: appointment.availability.startTime },
          windowEnd: { gt: appointment.availability.startTime },
          OR: [{ stream: null }, { stream: appointment.stream }],
        },
        include: {
          _count: { select: { appointments: true } },
        },
      });

      let waveIdToAssign: string | null = null;
      if (matchingWave && matchingWave._count.appointments < matchingWave.capacity) {
        waveIdToAssign = matchingWave.id;
        assignedWaveArrivalWindow = formatWaveArrivalWindowIST(
          matchingWave.windowStart,
          matchingWave.windowEnd
        );
      }

      await db.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CONFIRMED,
          waveId: waveIdToAssign,
        },
      });

      // Notify patient of confirmation
      const slotTimeFormatted = formatDateTimeIST(appointment.availability.startTime);
      const arrivalNote = assignedWaveArrivalWindow
        ? ` Arrival window: ${assignedWaveArrivalWindow}.`
        : "";

      await createNotification({
        userId: appointment.patient.userId,
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Consultation Confirmed",
        body: `Your consultation with Dr. ${user.name ?? "Practitioner"} on ${slotTimeFormatted} has been confirmed.${arrivalNote}`,
        href: "/patient/appointments",
      });
    } else if (targetStatus === "COMPLETED") {
      await db.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.COMPLETED,
          actualEndAt: now,
        },
      });
    } else if (targetStatus === "NO_SHOW") {
      await db.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.NO_SHOW,
        },
      });
    }

    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/queue");
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
        console.error("[updateDoctorAppointmentStatusAction] Prisma transaction API error (P2028):", error);
        return {
          success: false,
          error: "Operation timed out or connection was interrupted. Please try again.",
        };
      }
    }

    console.error("[updateDoctorAppointmentStatusAction] Error:", error);
    return {
      success: false,
      error: "Failed to update appointment status. Please try again.",
    };
  }
}
