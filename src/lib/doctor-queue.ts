import {
  AppointmentStatus,
  AvailabilityKind,
  WaveStatus,
} from "@/generated/prisma/enums";
import {
  calculateSubSlotQueues,
  type QueueSummary,
  type SubSlotQueueItem,
} from "@/lib/queue";
import {
  buildSubSlotQueueScopeKey,
  compareSubSlotTokenOrder,
  formatSubSlotLabel,
  formatSubSlotTimeLabel,
  getQueueStatusLabel,
  pickNextCallableAppointment,
} from "@/lib/queue-tokens";
import { effectiveSlot } from "@/lib/scheduling";
import { getISTDateString } from "@/lib/time";
import { formatWaveArrivalWindowIST } from "@/lib/waves";

export interface DoctorQueueSourceAppointment {
  id: string;
  availabilityId: string;
  status: AppointmentStatus;
  tokenNumber: number | null;
  queueScopeKey: string | null;
  checkedInAt: Date | null;
  calledAt: Date | null;
  noShowAt?: Date | null;
  completedAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  createdAt: Date;
  slotStart: Date | null;
  slotEnd: Date | null;
  patient: {
    id: string;
    user: {
      name: string | null;
    };
  };
  availability: {
    id: string;
    doctorId: string;
    kind: AvailabilityKind;
    startTime: Date;
    endTime: Date;
  };
  wave?: {
    windowStart: Date;
    windowEnd: Date;
    status: WaveStatus;
  } | null;
}

export interface DoctorQueuePatientRow {
  id: string;
  patientName: string;
  status: AppointmentStatus;
  statusLabel: string;
  tokenNumber: number | null;
  tokenLabel: string;
  queuePosition: number | null;
  isCurrent: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  expectedStart: string | null;
  delayMinutes: number;
  roundedDelayMinutes: number;
  checkedInAt: string | null;
  calledAt: string | null;
  noShowAt: string | null;
  completedAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  arrivalWindow: string | null;
  subSlotLabel: string;
}

export interface DoctorSubSlotQueue {
  availabilityId: string;
  queueScopeKey: string;
  kind: AvailabilityKind;
  subSlotLabel: string;
  timeRangeLabel: string;
  startTime: string;
  endTime: string;
  summary: QueueSummary;
  noShowCount: number;
  currentPatient: DoctorQueuePatientRow | null;
  nextInQueuePatient: DoctorQueuePatientRow | null;
  activePatients: DoctorQueuePatientRow[];
  completedPatients: DoctorQueuePatientRow[];
  notArrivedPatients: DoctorQueuePatientRow[];
}

export interface DoctorLiveQueueData {
  todayDateIST: string;
  activeDoctorCall: {
    appointmentId: string;
    patientName: string;
    tokenNumber: number | null;
    tokenLabel: string;
    queueScopeKey: string;
    subSlotLabel: string;
    status: AppointmentStatus;
    calledAt: string | null;
    actualStartAt: string | null;
  } | null;
  subSlots: DoctorSubSlotQueue[];
  defaultSelectedScopeKey: string | null;
}

/**
 * Pure read-only projection building the Doctor Portal's live sub-slot queue.
 * - Excludes PENDING_PAYMENT holds and CANCELLED bookings.
 * - Preserves NO_SHOW ("Not Arrived") and COMPLETED rows for read-only visibility
 *   while excluding them from active queue positions & wait-time estimates.
 * - Computes queue estimates and positions independently per sub-slot (`queueScopeKey`).
 */
export function buildDoctorLiveQueueData(
  rawAppointments: readonly DoctorQueueSourceAppointment[],
  now: Date = new Date()
): DoctorLiveQueueData {
  const todayDateIST = getISTDateString(now);

  const eligibleToday = rawAppointments.filter((appt) => {
    if (
      appt.status === AppointmentStatus.PENDING_PAYMENT ||
      appt.status === AppointmentStatus.CANCELLED
    ) {
      return false;
    }
    return getISTDateString(effectiveSlot(appt).start) === todayDateIST;
  });

  const resolvedScopeKey = (appt: DoctorQueueSourceAppointment) =>
    appt.queueScopeKey ??
    buildSubSlotQueueScopeKey({
      doctorId: appt.availability.doctorId,
      startTime: appt.availability.startTime,
      availabilityId: appt.availabilityId,
    });

  const subSlotInput: SubSlotQueueItem[] = eligibleToday.map((appt) => {
    const slot = effectiveSlot(appt);
    return {
      id: appt.id,
      status: appt.status,
      scheduledStart: slot.start,
      scheduledEnd: slot.end,
      actualStartAt: appt.actualStartAt,
      actualEndAt: appt.actualEndAt,
      checkedInAt: appt.checkedInAt,
      calledAt: appt.calledAt,
      tokenNumber: appt.tokenNumber,
      createdAt: appt.createdAt,
      queueScopeKey: resolvedScopeKey(appt),
    };
  });

  const { estimates, subSlotSummaries } = calculateSubSlotQueues(subSlotInput, now);

  // Detect any currently active CALLED or IN_CONSULTATION patient for this doctor today
  const globalActiveAppt =
    eligibleToday.find((a) => a.status === AppointmentStatus.IN_CONSULTATION) ??
    eligibleToday.find((a) => a.status === AppointmentStatus.CALLED) ??
    null;

  const activeDoctorCall = globalActiveAppt
    ? {
        appointmentId: globalActiveAppt.id,
        patientName: globalActiveAppt.patient.user.name ?? "Patient",
        tokenNumber: globalActiveAppt.tokenNumber,
        tokenLabel:
          typeof globalActiveAppt.tokenNumber === "number"
            ? `#${globalActiveAppt.tokenNumber}`
            : "Pending",
        queueScopeKey: resolvedScopeKey(globalActiveAppt),
        subSlotLabel: formatSubSlotLabel({
          kind: globalActiveAppt.availability.kind,
          availabilityStart: globalActiveAppt.availability.startTime,
          availabilityEnd: globalActiveAppt.availability.endTime,
          slotStart: globalActiveAppt.slotStart,
          slotEnd: globalActiveAppt.slotEnd,
        }),
        status: globalActiveAppt.status,
        calledAt: globalActiveAppt.calledAt ? globalActiveAppt.calledAt.toISOString() : null,
        actualStartAt: globalActiveAppt.actualStartAt
          ? globalActiveAppt.actualStartAt.toISOString()
          : null,
      }
    : null;

  // Group strictly by sub-slot queueScopeKey
  const byScope = new Map<string, DoctorQueueSourceAppointment[]>();
  for (const appt of eligibleToday) {
    const scopeKey = resolvedScopeKey(appt);
    const list = byScope.get(scopeKey);
    if (list) {
      list.push(appt);
    } else {
      byScope.set(scopeKey, [appt]);
    }
  }

  const subSlots: DoctorSubSlotQueue[] = [];

  for (const [scopeKey, group] of byScope.entries()) {
    const first = group[0]!;
    const summary: QueueSummary = subSlotSummaries.get(scopeKey) ?? {
      waiting: 0,
      called: 0,
      inProgress: 0,
      completed: 0,
      remaining: 0,
      runningBehindMinutes: 0,
    };

    const nextCallableRaw = pickNextCallableAppointment(group);

    const toRow = (appt: DoctorQueueSourceAppointment): DoctorQueuePatientRow => {
      const slot = effectiveSlot(appt);
      const est = estimates.get(appt.id);
      return {
        id: appt.id,
        patientName: appt.patient.user.name ?? "Patient",
        status: appt.status,
        statusLabel: getQueueStatusLabel(appt.status),
        tokenNumber: appt.tokenNumber,
        tokenLabel:
          typeof appt.tokenNumber === "number" ? `#${appt.tokenNumber}` : "—",
        queuePosition: est?.queuePosition ?? null,
        isCurrent:
          est?.isCurrent ??
          (appt.status === AppointmentStatus.CALLED ||
            appt.status === AppointmentStatus.IN_CONSULTATION),
        scheduledStart: slot.start.toISOString(),
        scheduledEnd: slot.end.toISOString(),
        expectedStart: est ? est.expectedStart.toISOString() : null,
        delayMinutes: est?.delayMinutes ?? 0,
        roundedDelayMinutes: est?.roundedDelayMinutes ?? 0,
        checkedInAt: appt.checkedInAt ? appt.checkedInAt.toISOString() : null,
        calledAt: appt.calledAt ? appt.calledAt.toISOString() : null,
        noShowAt: appt.noShowAt ? appt.noShowAt.toISOString() : null,
        completedAt: appt.completedAt ? appt.completedAt.toISOString() : null,
        actualStartAt: appt.actualStartAt ? appt.actualStartAt.toISOString() : null,
        actualEndAt: appt.actualEndAt ? appt.actualEndAt.toISOString() : null,
        arrivalWindow:
          appt.wave && appt.wave.status === WaveStatus.PUBLISHED
            ? formatWaveArrivalWindowIST(appt.wave.windowStart, appt.wave.windowEnd)
            : null,
        subSlotLabel: formatSubSlotLabel({
          kind: first.availability.kind,
          availabilityStart: first.availability.startTime,
          availabilityEnd: first.availability.endTime,
          slotStart: appt.slotStart,
          slotEnd: appt.slotEnd,
        }),
      };
    };

    const rows = group.map(toRow);
    const activePatients = rows
      .filter(
        (r) =>
          r.status !== AppointmentStatus.COMPLETED &&
          r.status !== AppointmentStatus.NO_SHOW
      )
      .sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        return compareSubSlotTokenOrder(a, b);
      });
    const completedPatients = rows
      .filter((r) => r.status === AppointmentStatus.COMPLETED)
      .sort(compareSubSlotTokenOrder);
    const notArrivedPatients = rows
      .filter((r) => r.status === AppointmentStatus.NO_SHOW)
      .sort(compareSubSlotTokenOrder);

    const currentPatient = activePatients.find((r) => r.isCurrent) ?? null;
    const nextInQueuePatient = nextCallableRaw
      ? activePatients.find((r) => r.id === nextCallableRaw.id) ?? null
      : null;

    subSlots.push({
      availabilityId: first.availability.id,
      queueScopeKey: scopeKey,
      kind: first.availability.kind,
      subSlotLabel: formatSubSlotLabel({
        kind: first.availability.kind,
        availabilityStart: first.availability.startTime,
        availabilityEnd: first.availability.endTime,
      }),
      timeRangeLabel: formatSubSlotTimeLabel({
        startTime: first.availability.startTime,
        endTime: first.availability.endTime,
      }),
      startTime: first.availability.startTime.toISOString(),
      endTime: first.availability.endTime.toISOString(),
      summary,
      noShowCount: notArrivedPatients.length,
      currentPatient,
      nextInQueuePatient,
      activePatients,
      completedPatients,
      notArrivedPatients,
    });
  }

  subSlots.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const defaultSelectedScopeKey =
    activeDoctorCall?.queueScopeKey ??
    subSlots.find((s) => s.summary.waiting > 0)?.queueScopeKey ??
    subSlots.find((s) => s.summary.remaining > 0)?.queueScopeKey ??
    subSlots[0]?.queueScopeKey ??
    null;

  return {
    todayDateIST,
    activeDoctorCall,
    subSlots,
    defaultSelectedScopeKey,
  };
}
