import {
  AppointmentStatus,
  AvailabilityKind,
  DoctorStatus,
  Role,
} from "@/generated/prisma/enums";
import {
  canMarkNoShow,
  canReceptionistCallNext,
  canReceptionistComplete,
  canReceptionistStartConsultation,
  isValidTransition,
} from "@/lib/appointment-status";
import {
  buildSubSlotQueueScopeKey,
  formatDoctorCalledNotification,
  formatSubSlotLabel,
  pickNextCallableAppointment,
} from "@/lib/queue-tokens";
import { getISTDateString, getISTDayRangeUTC } from "@/lib/time";

export interface CallNextCandidateRecord {
  id: string;
  status: AppointmentStatus;
  tokenNumber: number | null;
  checkedInAt: Date | null;
  createdAt: Date;
  actualStartAt: Date | null;
  slotStart: Date | null;
  slotEnd: Date | null;
  patientUserId: string;
  patientName: string | null;
}

export interface CallNextDoctorRecord {
  id: string;
  userId: string;
  status: DoctorStatus;
  name: string | null;
}

export interface CallNextAvailabilityRecord {
  id: string;
  doctorId: string;
  kind: AvailabilityKind;
  startTime: Date;
  endTime: Date;
}

export interface CallNextTxAdapter {
  findDoctor: (doctorId: string) => Promise<CallNextDoctorRecord | null>;
  lockDoctor: (doctorId: string) => Promise<void>;
  findAvailability: (availabilityId: string) => Promise<CallNextAvailabilityRecord | null>;
  findActiveDoctorCallOnDay: (params: {
    doctorId: string;
    dayStart: Date;
    nextDayStart: Date;
  }) => Promise<{
    id: string;
    status: AppointmentStatus;
    tokenNumber: number | null;
    patientName: string | null;
  } | null>;
  findSubSlotCheckedInCandidates: (
    availabilityId: string
  ) => Promise<CallNextCandidateRecord[]>;
  conditionalMarkCalled: (params: {
    appointmentId: string;
    calledAt: Date;
    calledByUserId: string;
  }) => Promise<number>;
  syncReminders: (params: {
    appointmentId: string;
    userId: string;
    slotStartTime: Date;
    status: AppointmentStatus;
  }) => Promise<void>;
}

export interface CallNextResult {
  success: boolean;
  error?: string;
  appointmentId?: string;
  doctorId?: string;
  doctorUserId?: string;
  doctorName?: string | null;
  tokenNumber?: number | null;
  patientName?: string;
  patientUserId?: string;
  subSlotLabel?: string;
  calledAt?: Date;
  notification?: { title: string; body: string };
}

/**
 * Concurrency-safe core execution for Receptionist "Call Next Patient" (CHECKED_IN -> CALLED).
 * - Strictly authorizes only RECEPTIONIST / ADMIN (rejects DOCTOR & PATIENT).
 * - Requires explicit `doctorId` and `availabilityId` belonging to that doctor.
 * - Serializes via doctor row lock (`FOR UPDATE`) and prevents concurrent/duplicate calls.
 */
export async function executeCallNextPatient(params: {
  tx: CallNextTxAdapter;
  actor: {
    id: string;
    role: Role;
  };
  doctorId: string;
  availabilityId: string;
  queueScopeKey?: string;
  now?: Date;
}): Promise<CallNextResult> {
  const { tx, actor, doctorId, availabilityId, queueScopeKey } = params;
  const now = params.now ?? new Date();

  const roleCheck = canReceptionistCallNext(
    { status: AppointmentStatus.CHECKED_IN },
    actor.role
  );
  if (!roleCheck.allowed) {
    return {
      success: false,
      error: roleCheck.reason ?? "Only clinic reception staff can call the next patient.",
    };
  }

  if (!doctorId?.trim() || !availabilityId?.trim()) {
    return {
      success: false,
      error: "Please select a doctor and sub-slot queue before calling the next patient.",
    };
  }

  const doctor = await tx.findDoctor(doctorId);
  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return {
      success: false,
      error: "Selected doctor could not be verified for consultations.",
    };
  }

  await tx.lockDoctor(doctor.id);

  const availability = await tx.findAvailability(availabilityId);
  if (
    !availability ||
    availability.doctorId !== doctor.id ||
    availability.kind === AvailabilityKind.WAVE_PARENT
  ) {
    return {
      success: false,
      error: "Selected sub-slot queue does not belong to the chosen doctor.",
    };
  }

  if (queueScopeKey) {
    const expectedScope = buildSubSlotQueueScopeKey({
      doctorId: doctor.id,
      startTime: availability.startTime,
      availabilityId: availability.id,
    });
    if (queueScopeKey !== expectedScope) {
      return {
        success: false,
        error: "Queue scope does not match the selected doctor, date, and sub-slot.",
      };
    }
  }

  const slotDateIST = getISTDateString(availability.startTime);
  const { start: dayStart, nextDayStart } = getISTDayRangeUTC(slotDateIST);

  const alreadyActive = await tx.findActiveDoctorCallOnDay({
    doctorId: doctor.id,
    dayStart,
    nextDayStart,
  });

  if (alreadyActive) {
    const activeName = alreadyActive.patientName ?? "a patient";
    const activeToken =
      typeof alreadyActive.tokenNumber === "number"
        ? ` (Token #${alreadyActive.tokenNumber})`
        : "";
    const activeLabel =
      alreadyActive.status === AppointmentStatus.IN_CONSULTATION
        ? "in consultation"
        : "already called";
    return {
      success: false,
      error: `${activeName}${activeToken} is ${activeLabel} for this doctor. Complete or mark Not Arrived before calling the next patient.`,
    };
  }

  const candidates = await tx.findSubSlotCheckedInCandidates(availability.id);
  const nextCandidate = pickNextCallableAppointment(candidates);

  if (!nextCandidate) {
    return {
      success: false,
      error: "No checked-in patients are currently waiting in this sub-slot queue.",
    };
  }

  if (!isValidTransition(nextCandidate.status, AppointmentStatus.CALLED, actor.role)) {
    return {
      success: false,
      error: "Selected appointment cannot be called in its current state.",
    };
  }

  const updatedCount = await tx.conditionalMarkCalled({
    appointmentId: nextCandidate.id,
    calledAt: now,
    calledByUserId: actor.id,
  });

  if (updatedCount !== 1) {
    return {
      success: false,
      error: "Another call request modified this patient concurrently. Please refresh.",
    };
  }

  await tx.syncReminders({
    appointmentId: nextCandidate.id,
    userId: nextCandidate.patientUserId,
    slotStartTime: availability.startTime,
    status: AppointmentStatus.CALLED,
  });

  const subSlotLabel = formatSubSlotLabel({
    kind: availability.kind,
    availabilityStart: availability.startTime,
    availabilityEnd: availability.endTime,
    slotStart: nextCandidate.slotStart,
    slotEnd: nextCandidate.slotEnd,
  });

  const notification = formatDoctorCalledNotification({
    doctorName: doctor.name,
    patientName: nextCandidate.patientName,
    tokenNumber: nextCandidate.tokenNumber,
    subSlotLabel,
    calledAt: now,
  });

  return {
    success: true,
    appointmentId: nextCandidate.id,
    doctorId: doctor.id,
    doctorUserId: doctor.userId,
    doctorName: doctor.name,
    tokenNumber: nextCandidate.tokenNumber,
    patientName: nextCandidate.patientName ?? "Patient",
    patientUserId: nextCandidate.patientUserId,
    subSlotLabel,
    calledAt: now,
    notification,
  };
}

export interface StaffOutcomeAppointmentRecord {
  id: string;
  doctorId: string;
  availabilityId: string;
  patientUserId: string;
  status: AppointmentStatus;
  slotStartTime: Date;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
}

export interface StaffOutcomeTxAdapter {
  lockDoctor?: (doctorId: string) => Promise<void>;
  findAppointment: (appointmentId: string) => Promise<StaffOutcomeAppointmentRecord | null>;
  findActiveInConsultationOnDay?: (params: {
    doctorId: string;
    dayStart: Date;
    nextDayStart: Date;
    excludeAppointmentId: string;
  }) => Promise<{ id: string } | null>;
  conditionalStartConsultation: (params: {
    appointmentId: string;
    actualStartAt: Date;
  }) => Promise<number>;
  conditionalMarkNoShow: (params: {
    appointmentId: string;
    noShowAt: Date;
    noShowByUserId: string;
  }) => Promise<number>;
  conditionalMarkCompleted: (params: {
    appointmentId: string;
    completedAt: Date;
    completedByUserId: string;
    actualStartAt: Date | null;
    actualEndAt: Date;
  }) => Promise<number>;
  syncReminders: (params: {
    appointmentId: string;
    userId: string;
    slotStartTime: Date;
    status: AppointmentStatus;
  }) => Promise<void>;
}

function validateScopeSelection(
  appt: StaffOutcomeAppointmentRecord,
  expectedDoctorId?: string,
  expectedAvailabilityId?: string
): string | null {
  if (expectedDoctorId && appt.doctorId !== expectedDoctorId) {
    return "Selected appointment does not belong to the chosen doctor queue.";
  }
  if (expectedAvailabilityId && appt.availabilityId !== expectedAvailabilityId) {
    return "Selected appointment does not belong to the chosen sub-slot queue.";
  }
  return null;
}

/**
 * Receptionist / Admin core action: Start Consultation (CALLED -> IN_CONSULTATION).
 * Preserves actualStartAt timestamp and serializes per doctor.
 */
export async function executeStartConsultation(params: {
  tx: StaffOutcomeTxAdapter;
  actor: { id: string; role: Role };
  appointmentId: string;
  expectedDoctorId?: string;
  expectedAvailabilityId?: string;
  now?: Date;
}): Promise<{ success: boolean; error?: string; doctorId?: string }> {
  const {
    tx,
    actor,
    appointmentId,
    expectedDoctorId,
    expectedAvailabilityId,
  } = params;
  const now = params.now ?? new Date();

  const authCheck = canReceptionistStartConsultation(
    { status: AppointmentStatus.CALLED },
    actor.role
  );
  if (!authCheck.allowed) {
    return { success: false, error: authCheck.reason ?? "Unauthorized." };
  }

  const appt = await tx.findAppointment(appointmentId);
  if (!appt) {
    return { success: false, error: "Appointment not found." };
  }

  const scopeError = validateScopeSelection(
    appt,
    expectedDoctorId,
    expectedAvailabilityId
  );
  if (scopeError) {
    return { success: false, error: scopeError };
  }

  if (!isValidTransition(appt.status, AppointmentStatus.IN_CONSULTATION, actor.role)) {
    return {
      success: false,
      error: `Consultation can only be started once the patient has been called. Current status: ${appt.status}.`,
    };
  }

  if (tx.lockDoctor) {
    await tx.lockDoctor(appt.doctorId);
  }

  if (tx.findActiveInConsultationOnDay) {
    const slotDateIST = getISTDateString(appt.slotStartTime);
    const { start: dayStart, nextDayStart } = getISTDayRangeUTC(slotDateIST);
    const existing = await tx.findActiveInConsultationOnDay({
      doctorId: appt.doctorId,
      dayStart,
      nextDayStart,
      excludeAppointmentId: appt.id,
    });
    if (existing) {
      return {
        success: false,
        error: "Doctor already has a consultation in progress. Complete it before starting the next.",
      };
    }
  }

  const updated = await tx.conditionalStartConsultation({
    appointmentId: appt.id,
    actualStartAt: appt.actualStartAt ?? now,
  });

  if (updated !== 1) {
    return {
      success: false,
      error: "Appointment status changed concurrently. Please refresh.",
    };
  }

  await tx.syncReminders({
    appointmentId: appt.id,
    userId: appt.patientUserId,
    slotStartTime: appt.slotStartTime,
    status: AppointmentStatus.IN_CONSULTATION,
  });

  return { success: true, doctorId: appt.doctorId };
}

/**
 * Receptionist core action to mark an appointment as Not Arrived (NO_SHOW).
 */
export async function executeMarkNotArrived(params: {
  tx: StaffOutcomeTxAdapter;
  actor: { id: string; role: Role };
  appointmentId: string;
  expectedDoctorId?: string;
  expectedAvailabilityId?: string;
  now?: Date;
}): Promise<{ success: boolean; error?: string; doctorId?: string }> {
  const { tx, actor, appointmentId, expectedDoctorId, expectedAvailabilityId } = params;
  const now = params.now ?? new Date();

  if (actor.role !== Role.RECEPTIONIST) {
    return { success: false, error: "Unauthorized: Only reception desk can mark Not Arrived." };
  }

  const appt = await tx.findAppointment(appointmentId);
  if (!appt) {
    return { success: false, error: "Appointment not found." };
  }

  const scopeError = validateScopeSelection(
    appt,
    expectedDoctorId,
    expectedAvailabilityId
  );
  if (scopeError) {
    return { success: false, error: scopeError };
  }

  if (!isValidTransition(appt.status, AppointmentStatus.NO_SHOW, actor.role)) {
    return {
      success: false,
      error: `Cannot mark appointment as Not Arrived from ${appt.status} status.`,
    };
  }

  const graceEval = canMarkNoShow(
    { status: appt.status, startTime: appt.slotStartTime },
    now
  );
  if (!graceEval.allowed) {
    return {
      success: false,
      error: graceEval.reason ?? "No-Show cannot be recorded yet.",
    };
  }

  const updated = await tx.conditionalMarkNoShow({
    appointmentId: appt.id,
    noShowAt: now,
    noShowByUserId: actor.id,
  });

  if (updated !== 1) {
    return {
      success: false,
      error: "Appointment status already changed. Please refresh.",
    };
  }

  await tx.syncReminders({
    appointmentId: appt.id,
    userId: appt.patientUserId,
    slotStartTime: appt.slotStartTime,
    status: AppointmentStatus.NO_SHOW,
  });

  return { success: true, doctorId: appt.doctorId };
}

/**
 * Receptionist / Admin core action to mark an IN_CONSULTATION appointment COMPLETED.
 * Records completion timestamp, actualEndAt, and receptionist user audit identity.
 */
export async function executeMarkCompleted(params: {
  tx: StaffOutcomeTxAdapter;
  actor: { id: string; role: Role };
  appointmentId: string;
  expectedDoctorId?: string;
  expectedAvailabilityId?: string;
  now?: Date;
}): Promise<{ success: boolean; error?: string; doctorId?: string }> {
  const { tx, actor, appointmentId, expectedDoctorId, expectedAvailabilityId } = params;
  const now = params.now ?? new Date();

  const completeEval = canReceptionistComplete(
    { status: AppointmentStatus.IN_CONSULTATION },
    actor.role
  );
  if (!completeEval.allowed) {
    return { success: false, error: completeEval.reason ?? "Unauthorized." };
  }

  const appt = await tx.findAppointment(appointmentId);
  if (!appt) {
    return { success: false, error: "Appointment not found." };
  }

  const scopeError = validateScopeSelection(
    appt,
    expectedDoctorId,
    expectedAvailabilityId
  );
  if (scopeError) {
    return { success: false, error: scopeError };
  }

  if (!isValidTransition(appt.status, AppointmentStatus.COMPLETED, actor.role)) {
    return {
      success: false,
      error: `Only in-consultation appointments can be marked completed. Current status: ${appt.status}.`,
    };
  }

  const updated = await tx.conditionalMarkCompleted({
    appointmentId: appt.id,
    completedAt: now,
    completedByUserId: actor.id,
    actualStartAt: appt.actualStartAt ?? now,
    actualEndAt: appt.actualEndAt ?? now,
  });

  if (updated !== 1) {
    return {
      success: false,
      error: "Appointment status already changed. Please refresh.",
    };
  }

  await tx.syncReminders({
    appointmentId: appt.id,
    userId: appt.patientUserId,
    slotStartTime: appt.slotStartTime,
    status: AppointmentStatus.COMPLETED,
  });

  return { success: true, doctorId: appt.doctorId };
}
