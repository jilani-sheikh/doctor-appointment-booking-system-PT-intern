"use server";

import { requireRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  Role,
  DoctorStatus,
  AppointmentStatus,
  VisitStream,
  Prisma,
} from "@/generated/prisma/client";
import {
  canPatientCheckIn,
  canDoctorNoShow,
} from "@/lib/appointment-status";
import { checkAndNotifyQueueDelay } from "@/lib/notifications";
import { syncAppointmentReminders } from "@/lib/notifications/reminders";
import { revalidatePath } from "next/cache";

/**
 * Patient self-check-in for their own confirmed appointment.
 * Permitted strictly from 30 minutes before slot start until slot end.
 * Uses conditional update (WHERE status = CONFIRMED) so duplicate clicks are safe.
 */
export async function patientCheckInAction(appointmentId: string) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    return { success: false, error: "Patient profile not found." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { availability: true },
  });

  if (!appointment || appointment.patientId !== user.patient.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const checkInEval = canPatientCheckIn({
    status: appointment.status,
    startTime: appointment.availability.startTime,
    endTime: appointment.availability.endTime,
  });

  if (!checkInEval.allowed) {
    return { success: false, error: checkInEval.reason ?? "Check-in is not permitted at this time." };
  }

  try {
    const updated = await db.appointment.updateMany({
      where: {
        id: appointmentId,
        status: AppointmentStatus.CONFIRMED,
        patientId: user.patient.id,
      },
      data: {
        status: AppointmentStatus.CHECKED_IN,
        checkedInAt: new Date(),
        checkedInByUserId: user.id,
      },
    });

    if (updated.count === 0) {
      return { success: false, error: "Appointment could not be checked in. Please refresh." };
    }

    // Skip remaining reminders since patient has checked in
    await syncAppointmentReminders(db, {
      appointmentId,
      userId: user.id,
      slotStartTime: appointment.availability.startTime,
      status: AppointmentStatus.CHECKED_IN,
    });

    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/appointments");

    return { success: true, message: "You have successfully checked in! The doctor will see you shortly." };
  } catch (error) {
    console.error("[patientCheckInAction] Error checking in:", error);
    return { success: false, error: "An unexpected error occurred during check-in." };
  }
}

/**
 * Doctor or Admin override to mark a patient as arrived.
 */
export async function doctorMarkArrivedAction(appointmentId: string) {
  const user = await requireUser();
  if (user.role !== Role.DOCTOR && user.role !== Role.ADMIN) {
    return { success: false, error: "Unauthorized." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { availability: true },
  });

  if (!appointment) {
    return { success: false, error: "Appointment not found." };
  }

  if (user.role === Role.DOCTOR) {
    if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) {
      return { success: false, error: "Approved doctor status required." };
    }
    if (appointment.availability.doctorId !== user.doctor.id) {
      return { success: false, error: "Unauthorized to manage this consultation." };
    }
  }

  if (appointment.status !== AppointmentStatus.CONFIRMED) {
    return {
      success: false,
      error: `Only confirmed appointments can be marked as arrived. Current status: ${appointment.status}.`,
    };
  }

  try {
    await db.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.CHECKED_IN,
        checkedInAt: new Date(),
        checkedInByUserId: user.id,
      },
    });

    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/appointments");
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");

    return { success: true, message: "Patient arrival recorded successfully." };
  } catch (error) {
    console.error("[doctorMarkArrivedAction] Error marking arrival:", error);
    return { success: false, error: "Failed to record patient arrival." };
  }
}

/**
 * Starts a consultation for a checked-in patient.
 *
 * Concurrency Safety (Promt5.md Amendment 3):
 * Runs in a short transaction with maxWait: 10000, timeout: 20000.
 * 1. Locks the doctor row via `SELECT id FROM doctors WHERE id = $1 FOR UPDATE`.
 * 2. Asserts doctor has NO appointment currently in IN_CONSULTATION status.
 * 3. Conditionally updates appointment (WHERE status = CHECKED_IN).
 * 4. Triggers QUEUE_DELAY notification post-commit if delay exceeds 20 minutes.
 */
export async function startConsultationAction(appointmentId: string) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can conduct consultations." };
  }

  try {
    await db.$transaction(
      async (tx) => {
        // 1. Lock doctor row for update to serialize start requests for this practitioner
        await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctor.id} FOR UPDATE`;

        // 2. Check for active consultation in progress
        const activeConsultation = await tx.appointment.findFirst({
          where: {
            availability: { doctorId: doctor.id },
            status: AppointmentStatus.IN_CONSULTATION,
          },
        });

        if (activeConsultation) {
          throw new Error("ACTIVE_CONSULTATION_IN_PROGRESS");
        }

        // 3. Conditionally start consultation
        const updated = await tx.appointment.updateMany({
          where: {
            id: appointmentId,
            status: AppointmentStatus.CHECKED_IN,
            availability: { doctorId: doctor.id },
          },
          data: {
            status: AppointmentStatus.IN_CONSULTATION,
            actualStartAt: new Date(),
          },
        });

        if (updated.count !== 1) {
          throw new Error("PATIENT_NOT_CHECKED_IN");
        }
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // After transaction commits, check for delay notifications
    await checkAndNotifyQueueDelay(doctor.id);

    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");

    return { success: true, message: "Consultation started." };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "ACTIVE_CONSULTATION_IN_PROGRESS") {
        return {
          success: false,
          error: "You already have a consultation in progress. Please complete it before starting the next.",
        };
      }
      if (error.message === "PATIENT_NOT_CHECKED_IN") {
        return {
          success: false,
          error: "Patient must be checked in before consultation can start.",
        };
      }
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2028") {
        console.error("[startConsultationAction] Transaction timeout error (P2028):", error);
        return { success: false, error: "The operation timed out. Please try again." };
      }
    }

    console.error("[startConsultationAction] Error starting consultation:", error);
    return { success: false, error: "Failed to start consultation." };
  }
}

/**
 * Ends an in-progress consultation, setting status to COMPLETED and recording actualEndAt.
 */
export async function endConsultationAction(appointmentId: string) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can conclude consultations." };
  }

  try {
    const updated = await db.appointment.updateMany({
      where: {
        id: appointmentId,
        status: AppointmentStatus.IN_CONSULTATION,
        availability: { doctorId: doctor.id },
      },
      data: {
        status: AppointmentStatus.COMPLETED,
        actualEndAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      return { success: false, error: "Consultation is not in progress or unauthorized." };
    }

    // After completion, notify downstream patients if queue delays remain
    await checkAndNotifyQueueDelay(doctor.id);

    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");

    return { success: true, message: "Consultation completed successfully." };
  } catch (error) {
    console.error("[endConsultationAction] Error ending consultation:", error);
    return { success: false, error: "Failed to record consultation completion." };
  }
}

/**
 * Records an appointment as a No-Show.
 * Enforces scheduled start time + 15 minute grace period.
 */
export async function doctorNoShowAction(appointmentId: string) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can record outcomes." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { availability: true },
  });

  if (!appointment || appointment.availability.doctorId !== doctor.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const noShowEval = canDoctorNoShow({
    status: appointment.status,
    startTime: appointment.availability.startTime,
  });

  if (!noShowEval.allowed) {
    return { success: false, error: noShowEval.reason ?? "No-Show cannot be recorded yet." };
  }

  try {
    await db.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.NO_SHOW,
      },
    });

    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/patient/appointments");

    return { success: true, message: "Appointment recorded as No-Show." };
  } catch (error) {
    console.error("[doctorNoShowAction] Error marking no-show:", error);
    return { success: false, error: "Failed to record no-show." };
  }
}

/**
 * Doctor or Admin action to designate an appointment's stream as PRIORITY (Amendment 5c).
 * Never accessible to patients (enforced server-side).
 */
export async function setPriorityStreamAction(appointmentId: string) {
  const user = await requireUser();
  if (user.role !== Role.DOCTOR && user.role !== Role.ADMIN) {
    return { success: false, error: "Only doctors and administrators can assign Priority stream." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { availability: true },
  });

  if (!appointment) {
    return { success: false, error: "Appointment not found." };
  }

  if (user.role === Role.DOCTOR) {
    if (!user.doctor || appointment.availability.doctorId !== user.doctor.id) {
      return { success: false, error: "Unauthorized to modify this consultation." };
    }
  }

  try {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { stream: VisitStream.PRIORITY },
    });

    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/waves");

    return { success: true, message: "Appointment stream updated to Priority." };
  } catch (error) {
    console.error("[setPriorityStreamAction] Error:", error);
    return { success: false, error: "Failed to update appointment stream." };
  }
}
