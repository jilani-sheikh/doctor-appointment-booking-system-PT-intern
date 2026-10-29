import { AppointmentStatus, Role } from "@/generated/prisma/enums";

/**
 * Single source of truth for appointment statuses, transitions, and timing constraints.
 */

export const CHECK_IN_WINDOW_MINUTES_BEFORE_START = 30;
export const NO_SHOW_GRACE_MINUTES = 15;
export const PATIENT_CANCEL_HOURS_BEFORE_START = 2;
export const PATIENT_RESCHEDULE_HOURS_BEFORE_START = 2;
export const MAX_RESCHEDULE_COUNT = 2;

/**
 * Terminal statuses cannot transition to any other status.
 */
export const TERMINAL_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
];

/**
 * Active statuses representing appointments awaiting action or in progress.
 */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_CONSULTATION,
];

export function isTerminalStatus(status: AppointmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isActiveStatus(status: AppointmentStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Evaluates whether a patient can self-check-in for their appointment.
 * Allowed strictly between (slot start - 30 minutes) and (slot end).
 */
export function canPatientCheckIn(
  appt: { status: AppointmentStatus; startTime: Date | string | number; endTime: Date | string | number },
  now: Date = new Date()
): { allowed: boolean; reason?: string } {
  if (appt.status !== AppointmentStatus.CONFIRMED) {
    if (appt.status === AppointmentStatus.CHECKED_IN || appt.status === AppointmentStatus.IN_CONSULTATION) {
      return { allowed: false, reason: "Already checked in." };
    }
    return { allowed: false, reason: "Only confirmed appointments can be checked in." };
  }

  const start = new Date(appt.startTime).getTime();
  const end = new Date(appt.endTime).getTime();
  const current = now.getTime();

  const windowStart = start - CHECK_IN_WINDOW_MINUTES_BEFORE_START * 60 * 1000;
  const windowEnd = end;

  if (current < windowStart) {
    const minutesLeft = Math.ceil((windowStart - current) / (60 * 1000));
    return {
      allowed: false,
      reason: `Check-in opens 30 minutes before your consultation (in ${minutesLeft} min).`,
    };
  }

  if (current > windowEnd) {
    return {
      allowed: false,
      reason: "The check-in window for this consultation has expired.",
    };
  }

  return { allowed: true };
}

/**
 * Evaluates whether a doctor can record an appointment as a No-Show.
 * Allowed only after slot start time + 15 minutes grace period.
 */
export function canDoctorNoShow(
  appt: { status: AppointmentStatus; startTime: Date | string | number },
  now: Date = new Date()
): { allowed: boolean; reason?: string } {
  if (appt.status !== AppointmentStatus.CONFIRMED && appt.status !== AppointmentStatus.CHECKED_IN) {
    return {
      allowed: false,
      reason: `Cannot record No-Show for appointment in ${appt.status} status.`,
    };
  }

  const start = new Date(appt.startTime).getTime();
  const graceEnd = start + NO_SHOW_GRACE_MINUTES * 60 * 1000;

  if (now.getTime() < graceEnd) {
    const minRemaining = Math.ceil((graceEnd - now.getTime()) / (60 * 1000));
    return {
      allowed: false,
      reason: `No-Show can only be recorded 15 minutes after scheduled start time (${minRemaining} min remaining).`,
    };
  }

  return { allowed: true };
}

/**
 * Evaluates whether a patient can cancel their appointment.
 * - Disrupted appointments can be cancelled anytime (if PENDING or CONFIRMED).
 * - Standard appointments require ≥ 2 hours before scheduled slot start.
 * - Patients CANNOT cancel once CHECKED_IN, IN_CONSULTATION, or in any terminal status.
 */
export function canPatientCancel(
  appt: {
    status: AppointmentStatus;
    startTime: Date | string | number;
    disruptedAt?: Date | string | number | null;
  },
  now: Date = new Date()
): { allowed: boolean; reason?: string } {
  if (appt.status !== AppointmentStatus.PENDING && appt.status !== AppointmentStatus.CONFIRMED) {
    return {
      allowed: false,
      reason: `Appointments in ${appt.status.toLowerCase()} status cannot be cancelled by patients.`,
    };
  }

  // If the appointment was disrupted by a doctor absence, cancellation window is waived
  if (appt.disruptedAt) {
    return { allowed: true };
  }

  const start = new Date(appt.startTime).getTime();
  const minCancelTime = now.getTime() + PATIENT_CANCEL_HOURS_BEFORE_START * 60 * 60 * 1000;

  if (start <= minCancelTime) {
    return {
      allowed: false,
      reason: "Appointments can only be cancelled at least 2 hours before the consultation time.",
    };
  }

  return { allowed: true };
}

/**
 * Evaluates whether a patient can reschedule their appointment.
 * - Max 2 reschedules per appointment.
 * - Must be PENDING or CONFIRMED.
 * - Must be > 2 hours before start (unless disrupted, which waives the 2 hour rule).
 */
export function canPatientReschedule(
  appt: {
    status: AppointmentStatus;
    startTime: Date | string | number;
    rescheduleCount: number;
    disruptedAt?: Date | string | number | null;
  },
  now: Date = new Date()
): { allowed: boolean; reason?: string } {
  if (appt.rescheduleCount >= MAX_RESCHEDULE_COUNT) {
    return {
      allowed: false,
      reason: `Maximum of ${MAX_RESCHEDULE_COUNT} reschedules reached for this appointment.`,
    };
  }

  if (appt.status !== AppointmentStatus.PENDING && appt.status !== AppointmentStatus.CONFIRMED) {
    return {
      allowed: false,
      reason: `Appointments in ${appt.status.toLowerCase()} status cannot be rescheduled.`,
    };
  }

  if (appt.disruptedAt) {
    return { allowed: true };
  }

  const start = new Date(appt.startTime).getTime();
  const minRescheduleTime = now.getTime() + PATIENT_RESCHEDULE_HOURS_BEFORE_START * 60 * 60 * 1000;

  if (start <= minRescheduleTime) {
    return {
      allowed: false,
      reason: "Appointments can only be rescheduled at least 2 hours in advance.",
    };
  }

  return { allowed: true };
}

/**
 * Validates whether a requested status transition is clinically and role permissible.
 */
export function isValidTransition(
  current: AppointmentStatus,
  target: AppointmentStatus,
  role: Role
): boolean {
  if (isTerminalStatus(current)) {
    return false;
  }

  switch (current) {
    case AppointmentStatus.PENDING:
      if (target === AppointmentStatus.CONFIRMED) {
        return role === Role.DOCTOR || role === Role.ADMIN;
      }
      if (target === AppointmentStatus.CANCELLED) {
        return true; // patient, doctor, or admin
      }
      return false;

    case AppointmentStatus.CONFIRMED:
      if (target === AppointmentStatus.CHECKED_IN) {
        return true; // patient self check-in, or doctor/admin override
      }
      if (target === AppointmentStatus.CANCELLED) {
        return true;
      }
      if (target === AppointmentStatus.NO_SHOW) {
        return role === Role.DOCTOR || role === Role.ADMIN;
      }
      return false;

    case AppointmentStatus.CHECKED_IN:
      if (target === AppointmentStatus.IN_CONSULTATION) {
        return role === Role.DOCTOR;
      }
      if (target === AppointmentStatus.CANCELLED || target === AppointmentStatus.NO_SHOW) {
        return role === Role.DOCTOR || role === Role.ADMIN;
      }
      return false;

    case AppointmentStatus.IN_CONSULTATION:
      if (target === AppointmentStatus.COMPLETED) {
        return role === Role.DOCTOR;
      }
      return false;

    default:
      return false;
  }
}
