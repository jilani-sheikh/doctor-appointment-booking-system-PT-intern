import {
  AppointmentStatus,
  DoctorStatus,
  Role,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { canPatientCheckIn, canStaffCheckIn } from "@/lib/appointment-status";
import { syncAppointmentReminders } from "@/lib/notifications/reminders";
import { effectiveSlot } from "@/lib/scheduling";

export interface CheckInActor {
  id: string;
  role: Role | null;
  patientId?: string | null;
  doctor?: {
    id: string;
    status: DoctorStatus;
  } | null;
}

export type StaffCheckInActor = CheckInActor;

export interface CheckInResult {
  success: boolean;
  message?: string;
  error?: string;
  alreadyCheckedIn?: boolean;
  checkedInAt?: string;
}

export type StaffCheckInResult = CheckInResult;

export interface CheckInTransactionClient {
  lockAppointmentRow: (appointmentId: string) => Promise<void>;
  findAppointment: (appointmentId: string) => Promise<{
    id: string;
    patientId: string;
    availabilityId?: string;
    status: AppointmentStatus;
    slotStart: Date | null;
    slotEnd: Date | null;
    availability: {
      id?: string;
      doctorId: string;
      startTime: Date;
      endTime: Date;
    };
    patient: {
      userId: string;
    };
  } | null>;
  conditionalCheckIn: (input: {
    appointmentId: string;
    checkedInAt: Date;
    checkedInByUserId: string;
  }) => Promise<number>;
  syncReminders: (params: {
    appointmentId: string;
    userId: string;
    slotStartTime: Date;
    status: AppointmentStatus;
  }) => Promise<void>;
}

/**
 * Shared atomic transactional check-in workflow used by Patient self check-in
 * and Receptionist Check In.
 *
 * Invariants:
 * - Acquires row-level lock (`FOR UPDATE`) so concurrent check-in attempts serialize safely.
 * - Enforces role-specific ownership & timing rules (`canPatientCheckIn` 30m window for PATIENT,
 *   `canStaffCheckIn` strictly for RECEPTIONIST).
 * - Uses conditional update (`WHERE status = CONFIRMED`) so duplicates never overwrite `checkedInAt`.
 * - Marks pending reminders SKIPPED inside the same transaction.
 */
export async function executeCheckInTransaction(
  tx: CheckInTransactionClient,
  input: {
    appointmentId: string;
    actor: CheckInActor;
    expectedDoctorId?: string;
    expectedAvailabilityId?: string;
    now?: Date;
  }
): Promise<CheckInResult> {
  const {
    appointmentId,
    actor,
    expectedDoctorId,
    expectedAvailabilityId,
    now = new Date(),
  } = input;

  if (actor.role !== Role.PATIENT && actor.role !== Role.RECEPTIONIST) {
    return { success: false, error: "Unauthorized." };
  }

  if (actor.role === Role.PATIENT && !actor.patientId) {
    return { success: false, error: "Patient profile not found." };
  }

  if (!appointmentId || !appointmentId.trim()) {
    return { success: false, error: "Appointment identifier is required." };
  }

  await tx.lockAppointmentRow(appointmentId);

  const appointment = await tx.findAppointment(appointmentId);
  if (!appointment) {
    return {
      success: false,
      error:
        actor.role === Role.PATIENT
          ? "Appointment not found or unauthorized."
          : "Appointment not found.",
    };
  }

  const slot = effectiveSlot(appointment);

  if (actor.role === Role.PATIENT) {
    if (appointment.patientId !== actor.patientId) {
      return { success: false, error: "Appointment not found or unauthorized." };
    }

    const checkInEval = canPatientCheckIn(
      {
        status: appointment.status,
        startTime: slot.start,
        endTime: slot.end,
      },
      now
    );

    if (!checkInEval.allowed) {
      return {
        success: false,
        alreadyCheckedIn:
          appointment.status === AppointmentStatus.CHECKED_IN ||
          appointment.status === AppointmentStatus.CALLED ||
          appointment.status === AppointmentStatus.IN_CONSULTATION,
        error: checkInEval.reason ?? "Check-in is not permitted at this time.",
      };
    }
  } else {
    if (
      expectedDoctorId &&
      appointment.availability.doctorId !== expectedDoctorId
    ) {
      return {
        success: false,
        error: "Selected appointment does not belong to the chosen doctor queue.",
      };
    }

    const apptAvailId = appointment.availabilityId ?? appointment.availability.id;
    if (
      expectedAvailabilityId &&
      apptAvailId &&
      apptAvailId !== expectedAvailabilityId
    ) {
      return {
        success: false,
        error: "Selected appointment does not belong to the chosen sub-slot queue.",
      };
    }

    const evalResult = canStaffCheckIn({ status: appointment.status }, actor.role);
    if (!evalResult.allowed) {
      return {
        success: false,
        alreadyCheckedIn: evalResult.alreadyCheckedIn,
        error:
          evalResult.reason ??
          `Only confirmed appointments can be checked in. Current status: ${appointment.status}.`,
      };
    }
  }

  const updatedCount = await tx.conditionalCheckIn({
    appointmentId,
    checkedInAt: now,
    checkedInByUserId: actor.id,
  });

  if (updatedCount !== 1) {
    return {
      success: false,
      error: "Appointment status changed concurrently. Please refresh.",
    };
  }

  await tx.syncReminders({
    appointmentId,
    userId: appointment.patient.userId,
    slotStartTime: slot.start,
    status: AppointmentStatus.CHECKED_IN,
  });

  return {
    success: true,
    alreadyCheckedIn: false,
    checkedInAt: now.toISOString(),
    message:
      actor.role === Role.PATIENT
        ? "You have successfully checked in! The doctor will see you shortly."
        : "Patient arrival recorded successfully.",
  };
}

/**
 * Backward-compatible alias for staff check-in tests and callers.
 */
export const executeStaffCheckInTransaction = executeCheckInTransaction;

/**
 * Adapts a real Prisma TransactionClient to `CheckInTransactionClient`.
 */
export function createPrismaCheckInClient(
  tx: Prisma.TransactionClient
): CheckInTransactionClient {
  return {
    lockAppointmentRow: async (appointmentId) => {
      await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE`;
    },
    findAppointment: (appointmentId) =>
      tx.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          patientId: true,
          availabilityId: true,
          status: true,
          slotStart: true,
          slotEnd: true,
          availability: {
            select: {
              id: true,
              doctorId: true,
              startTime: true,
              endTime: true,
            },
          },
          patient: {
            select: {
              userId: true,
            },
          },
        },
      }),
    conditionalCheckIn: async ({ appointmentId, checkedInAt, checkedInByUserId }) => {
      const res = await tx.appointment.updateMany({
        where: {
          id: appointmentId,
          status: AppointmentStatus.CONFIRMED,
        },
        data: {
          status: AppointmentStatus.CHECKED_IN,
          checkedInAt,
          checkedInByUserId,
        },
      });
      return res.count;
    },
    syncReminders: async (params) => {
      await syncAppointmentReminders(tx, params);
    },
  };
}
