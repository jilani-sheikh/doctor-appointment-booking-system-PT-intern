import {
  AppointmentStatus,
  AvailabilityKind,
  Role,
  VisitStream,
  WaveStatus,
} from "@/generated/prisma/enums";
import {
  canMarkNoShow,
  canReceptionistComplete,
  canReceptionistStartConsultation,
  canStaffCheckIn,
  isValidTransition,
} from "@/lib/appointment-status";
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
  pickNextCallableAppointment,
} from "@/lib/queue-tokens";
import { effectiveSlot } from "@/lib/scheduling";
import { getISTDateString } from "@/lib/time";
import { formatWaveArrivalWindowIST } from "@/lib/waves";

export interface ReceptionistSourceAppointment {
  id: string;
  availabilityId?: string;
  status: AppointmentStatus;
  stream: VisitStream;
  reason?: string | null;
  tokenNumber?: number | null;
  queueScopeKey?: string | null;
  checkedInAt?: Date | null;
  checkedInByUserId?: string | null;
  calledAt?: Date | null;
  completedAt?: Date | null;
  noShowAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  slotStart?: Date | null;
  slotEnd?: Date | null;
  createdAt?: Date | null;
  patient: {
    id: string;
    phone?: string | null;
    user: {
      name?: string | null;
      email?: string | null;
    };
  };
  availability: {
    id?: string;
    kind?: AvailabilityKind;
    startTime: Date;
    endTime: Date;
    doctor: {
      id: string;
      specialization: string;
      user: {
        name?: string | null;
      };
    };
  };
  wave?: {
    windowStart: Date;
    windowEnd: Date;
    status: WaveStatus;
  } | null;
}

export interface ReceptionistCalledNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface SerializedReceptionistAppointment {
  id: string;
  referenceCode: string;
  patientId: string;
  patientName: string;
  contact: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialization: string;
  availabilityId: string;
  queueScopeKey: string;
  subSlotLabel: string;
  subSlotTimeLabel: string;
  stream: VisitStream;
  status: AppointmentStatus;
  reason: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  arrivalWindow: string | null;
  tokenNumber: number | null;
  tokenLabel: string;
  queuePosition: number | null;
  expectedStart: string | null;
  roundedDelayMinutes: number;
  isCurrent: boolean;
  isCalled: boolean;
  isInConsultation: boolean;
  isCheckedIn: boolean;
  alreadyCheckedIn: boolean;
  canCheckIn: boolean;
  canStartConsultation: boolean;
  canMarkNotArrived: boolean;
  canShowNotArrivedAction: boolean;
  notArrivedDisabledReason: string | null;
  canMarkCompleted: boolean;
  checkedInAt: string | null;
  calledAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  completedAt: string | null;
}

export interface SerializedReceptionistSubSlotQueue {
  doctorId: string;
  doctorName: string;
  availabilityId: string;
  queueScopeKey: string;
  subSlotLabel: string;
  timeRangeLabel: string;
  startTime: string;
  summary: QueueSummary;
  currentlyConsulting: SerializedReceptionistAppointment | null;
  nextPatient: SerializedReceptionistAppointment | null;
  canCallNext: boolean;
  callDisabledReason: string | null;
  activeQueue: SerializedReceptionistAppointment[];
}

export interface SerializedReceptionistDoctorQueue {
  doctorId: string;
  doctorName: string;
  specialization: string;
  runningBehindMinutes: number;
  waiting: number;
  called: number;
  inProgress: number;
  completed: number;
  noShow: number;
  cancelled: number;
  awaitingArrival: number;
  currentlyConsulting: SerializedReceptionistAppointment | null;
  nextPatient: SerializedReceptionistAppointment | null;
  subSlots: SerializedReceptionistSubSlotQueue[];
  activeQueue: SerializedReceptionistAppointment[];
  completedPatients: SerializedReceptionistAppointment[];
  noShowPatients: SerializedReceptionistAppointment[];
  cancelledPatients: SerializedReceptionistAppointment[];
}

export interface ReceptionistDashboardOverview {
  totalAppointmentsToday: number;
  checkedInPatients: number;
  waitingPatients: number;
  calledPatients: number;
  inConsultation: number;
  completedConsultations: number;
  noShowPatients: number;
  awaitingArrival: number;
  cancelledAppointments: number;
  paymentHoldAppointments: number;
}

export interface ReceptionistDashboardData {
  todayDateIST: string;
  selectedDateIST: string;
  isSelectedDateToday: boolean;
  overview: ReceptionistDashboardOverview;
  appointments: SerializedReceptionistAppointment[];
  doctors: Array<{ id: string; name: string; specialization: string }>;
  doctorQueues: SerializedReceptionistDoctorQueue[];
  calledNotifications: ReceptionistCalledNotification[];
}

export interface ReceptionistFilterOptions {
  search: string;
  doctorId: string;
  subSlotScopeKey?: string;
  appointmentStatus: AppointmentStatus | "ALL";
  checkInStatus: "ALL" | "CHECKED_IN" | "NOT_CHECKED_IN";
}

function resolveSourceAvailabilityId(
  appt: ReceptionistSourceAppointment,
  doctorId: string,
  slotStart: Date
): string {
  return (
    appt.availabilityId ??
    appt.availability.id ??
    `${doctorId}:${getISTDateString(slotStart)}:${slotStart.toISOString()}`
  );
}

/**
 * Pure domain projection building receptionist overview counts, appointment table rows,
 * sub-slot queues, and doctor-wise consultation control states strictly using independent
 * per-sub-slot queue calculations and persisted appointment token numbers.
 */
export function buildReceptionistDashboardData(
  rawAppointments: ReceptionistSourceAppointment[],
  now: Date = new Date(),
  calledNotifications: ReceptionistCalledNotification[] = [],
  selectedDateISTParam?: string,
  allApprovedDoctors: Array<{ id: string; name: string; specialization: string }> = []
): ReceptionistDashboardData {
  const actualTodayIST = getISTDateString(now);
  const selectedDateIST = selectedDateISTParam ?? actualTodayIST;

  const targetDateAppointments = rawAppointments.filter((appt) => {
    const slot = effectiveSlot(appt);
    return getISTDateString(slot.start) === selectedDateIST;
  });

  // Group by doctor for UI organization & per-doctor active call verification
  const byDoctor = new Map<string, ReceptionistSourceAppointment[]>();
  for (const appt of targetDateAppointments) {
    const docId = appt.availability.doctor.id;
    const list = byDoctor.get(docId);
    if (list) {
      list.push(appt);
    } else {
      byDoctor.set(docId, [appt]);
    }
  }

  const serializedAll: SerializedReceptionistAppointment[] = [];
  const doctorQueues: SerializedReceptionistDoctorQueue[] = [];
  const doctorsMap = new Map<string, { id: string; name: string; specialization: string }>();

  for (const doc of allApprovedDoctors) {
    doctorsMap.set(doc.id, doc);
  }

  for (const [doctorId, docAppts] of byDoctor.entries()) {
    const sampleDoc = docAppts[0]!.availability.doctor;
    const doctorName = sampleDoc.user.name ?? "Practitioner";
    const specialization = sampleDoc.specialization;

    doctorsMap.set(doctorId, { id: doctorId, name: doctorName, specialization });

    // Exclude PENDING_PAYMENT holds from queue calculations so temporary holds never
    // distort live queue positions or wait estimates.
    const queueEligibleDocAppts = docAppts.filter(
      (appt) => appt.status !== AppointmentStatus.PENDING_PAYMENT
    );

    const resolveScopeKey = (appt: ReceptionistSourceAppointment) => {
      if (appt.queueScopeKey) return appt.queueScopeKey;
      const availId = resolveSourceAvailabilityId(
        appt,
        doctorId,
        appt.availability.startTime
      );
      return buildSubSlotQueueScopeKey({
        doctorId,
        startTime: appt.availability.startTime,
        availabilityId: availId,
      });
    };

    const subSlotItems: SubSlotQueueItem[] = queueEligibleDocAppts.map((appt) => {
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
        tokenNumber: appt.tokenNumber ?? null,
        createdAt: appt.createdAt ?? null,
        queueScopeKey: resolveScopeKey(appt),
      };
    });

    const { estimates, subSlotSummaries } = calculateSubSlotQueues(subSlotItems, now);

    const docSerialized: SerializedReceptionistAppointment[] = docAppts.map((appt) => {
      const slot = effectiveSlot(appt);
      const availId = resolveSourceAvailabilityId(
        appt,
        doctorId,
        appt.availability.startTime
      );
      const scopeKey = resolveScopeKey(appt);
      const est = estimates.get(appt.id) ?? null;

      const checkInEval = canStaffCheckIn({ status: appt.status }, Role.RECEPTIONIST);
      const startEval = canReceptionistStartConsultation(
        { status: appt.status },
        Role.RECEPTIONIST
      );
      const noShowTransitionAllowed = isValidTransition(
        appt.status,
        AppointmentStatus.NO_SHOW,
        Role.RECEPTIONIST
      );
      const noShowGraceEval = canMarkNoShow(
        { status: appt.status, startTime: slot.start },
        now
      );
      const completeEval = canReceptionistComplete(
        { status: appt.status },
        Role.RECEPTIONIST
      );

      const alreadyCheckedIn =
        appt.status === AppointmentStatus.CHECKED_IN ||
        appt.status === AppointmentStatus.CALLED ||
        appt.status === AppointmentStatus.IN_CONSULTATION;

      // Cancelled and No-Show appointments never count as checked-in visits even if checkedInAt was stamped earlier.
      const isCheckedIn =
        appt.status !== AppointmentStatus.CANCELLED &&
        appt.status !== AppointmentStatus.NO_SHOW &&
        (alreadyCheckedIn ||
          (appt.status === AppointmentStatus.COMPLETED && Boolean(appt.checkedInAt)));

      // Persist token strictly from appointment.tokenNumber (never inferred from mutable array index).
      const persistedToken =
        typeof appt.tokenNumber === "number" && appt.tokenNumber > 0
          ? appt.tokenNumber
          : null;

      const contact =
        appt.patient.phone?.trim() ||
        appt.patient.user.email?.trim() ||
        "No contact on file";
      const arrivalWindow =
        appt.wave && appt.wave.status === WaveStatus.PUBLISHED
          ? formatWaveArrivalWindowIST(appt.wave.windowStart, appt.wave.windowEnd)
          : null;

      return {
        id: appt.id,
        referenceCode: appt.id.slice(-6).toUpperCase(),
        patientId: appt.patient.id,
        patientName: appt.patient.user.name ?? "Patient",
        contact,
        doctorId,
        doctorName,
        doctorSpecialization: specialization,
        availabilityId: availId,
        queueScopeKey: scopeKey,
        subSlotLabel: formatSubSlotLabel({
          kind: appt.availability.kind ?? null,
          availabilityStart: appt.availability.startTime,
          availabilityEnd: appt.availability.endTime,
          slotStart: appt.slotStart,
          slotEnd: appt.slotEnd,
        }),
        subSlotTimeLabel: formatSubSlotTimeLabel({
          startTime: appt.availability.startTime,
          endTime: appt.availability.endTime,
        }),
        stream: appt.stream,
        status: appt.status,
        reason: appt.reason ?? null,
        scheduledStart: slot.start.toISOString(),
        scheduledEnd: slot.end.toISOString(),
        arrivalWindow,
        tokenNumber: persistedToken,
        tokenLabel: persistedToken !== null ? `#${persistedToken}` : "—",
        queuePosition: est?.queuePosition ?? null,
        expectedStart: est ? est.expectedStart.toISOString() : null,
        roundedDelayMinutes: est?.roundedDelayMinutes ?? 0,
        isCurrent:
          est?.isCurrent ??
          (appt.status === AppointmentStatus.CALLED ||
            appt.status === AppointmentStatus.IN_CONSULTATION),
        isCalled: appt.status === AppointmentStatus.CALLED,
        isInConsultation: appt.status === AppointmentStatus.IN_CONSULTATION,
        isCheckedIn,
        alreadyCheckedIn,
        canCheckIn: checkInEval.allowed,
        canStartConsultation: startEval.allowed,
        canMarkNotArrived: noShowTransitionAllowed && noShowGraceEval.allowed,
        canShowNotArrivedAction: noShowTransitionAllowed,
        notArrivedDisabledReason: noShowGraceEval.allowed
          ? null
          : noShowGraceEval.reason ?? null,
        canMarkCompleted: completeEval.allowed,
        checkedInAt: appt.checkedInAt ? appt.checkedInAt.toISOString() : null,
        calledAt: appt.calledAt ? appt.calledAt.toISOString() : null,
        actualStartAt: appt.actualStartAt ? appt.actualStartAt.toISOString() : null,
        actualEndAt: appt.actualEndAt ? appt.actualEndAt.toISOString() : null,
        completedAt: appt.completedAt ? appt.completedAt.toISOString() : null,
      };
    });

    serializedAll.push(...docSerialized);

    const activeQueue = docSerialized
      .filter((item) => item.queuePosition !== null)
      .sort((a, b) => {
        const startDiff =
          new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
        if (startDiff !== 0) return startDiff;
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        return (a.queuePosition ?? 9999) - (b.queuePosition ?? 9999);
      });

    // Doctor-wide currently CALLED or IN_CONSULTATION blocker on this date
    const doctorActiveCall =
      activeQueue.find(
        (item) =>
          item.status === AppointmentStatus.CALLED ||
          item.status === AppointmentStatus.IN_CONSULTATION
      ) ?? null;

    // Group serialized active rows per sub-slot queueScopeKey
    const subSlotGroupsMap = new Map<string, SerializedReceptionistAppointment[]>();
    for (const item of docSerialized) {
      if (item.status === AppointmentStatus.PENDING_PAYMENT) continue;
      const list = subSlotGroupsMap.get(item.queueScopeKey);
      if (list) {
        list.push(item);
      } else {
        subSlotGroupsMap.set(item.queueScopeKey, [item]);
      }
    }

    const subSlots: SerializedReceptionistSubSlotQueue[] = [];
    for (const [scopeKey, group] of subSlotGroupsMap.entries()) {
      const sample = group[0]!;
      const activeSubSlotRows = group
        .filter((item) => item.queuePosition !== null)
        .sort((a, b) => {
          if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
          const posDiff = (a.queuePosition ?? 9999) - (b.queuePosition ?? 9999);
          if (posDiff !== 0) return posDiff;
          return compareSubSlotTokenOrder(a, b);
        });

      const summary = subSlotSummaries.get(scopeKey) ?? {
        waiting: 0,
        called: 0,
        inProgress: 0,
        completed: 0,
        remaining: 0,
        runningBehindMinutes: 0,
      };

      const currentlyConsulting =
        activeSubSlotRows.find((item) => item.isCurrent) ?? null;
      const nextCallable = pickNextCallableAppointment(
        activeSubSlotRows.map((row) => ({
          id: row.id,
          status: row.status,
          tokenNumber: row.tokenNumber,
          checkedInAt: row.checkedInAt,
          createdAt: row.scheduledStart,
        }))
      );
      const nextPatient = nextCallable
        ? activeSubSlotRows.find((item) => item.id === nextCallable.id) ?? null
        : null;

      let callDisabledReason: string | null = null;
      if (doctorActiveCall) {
        callDisabledReason = `${doctorActiveCall.patientName} (Token ${doctorActiveCall.tokenLabel}) is already ${
          doctorActiveCall.status === AppointmentStatus.IN_CONSULTATION
            ? "in consultation"
            : "called"
        } for Dr. ${doctorName}.`;
      } else if (!nextPatient) {
        callDisabledReason = "No checked-in patient waiting in this sub-slot.";
      }

      subSlots.push({
        doctorId,
        doctorName,
        availabilityId: sample.availabilityId,
        queueScopeKey: scopeKey,
        subSlotLabel: sample.subSlotLabel,
        timeRangeLabel: sample.subSlotTimeLabel,
        startTime: sample.scheduledStart,
        summary,
        currentlyConsulting,
        nextPatient,
        canCallNext: !doctorActiveCall && nextPatient !== null,
        callDisabledReason,
        activeQueue: activeSubSlotRows,
      });
    }

    subSlots.sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    const completedPatients = docSerialized
      .filter((item) => item.status === AppointmentStatus.COMPLETED)
      .sort(
        (a, b) =>
          new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()
      );
    const noShowPatients = docSerialized
      .filter((item) => item.status === AppointmentStatus.NO_SHOW)
      .sort(
        (a, b) =>
          new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()
      );
    const cancelledPatients = docSerialized
      .filter((item) => item.status === AppointmentStatus.CANCELLED)
      .sort(
        (a, b) =>
          new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()
      );

    const checkedInAll = activeQueue.filter(
      (item) => item.status === AppointmentStatus.CHECKED_IN
    );
    const nextPatient = checkedInAll[0] ?? null;
    const awaitingArrival = docSerialized.filter(
      (item) => item.status === AppointmentStatus.CONFIRMED
    ).length;

    let runningBehindMinutes = 0;
    for (const ss of subSlots) {
      if (ss.summary.runningBehindMinutes > runningBehindMinutes) {
        runningBehindMinutes = ss.summary.runningBehindMinutes;
      }
    }

    doctorQueues.push({
      doctorId,
      doctorName,
      specialization,
      runningBehindMinutes,
      waiting: docSerialized.filter(
        (a) => a.status === AppointmentStatus.CHECKED_IN
      ).length,
      called: docSerialized.filter(
        (a) => a.status === AppointmentStatus.CALLED
      ).length,
      inProgress: docSerialized.filter(
        (a) =>
          a.status === AppointmentStatus.CALLED ||
          a.status === AppointmentStatus.IN_CONSULTATION
      ).length,
      completed: completedPatients.length,
      noShow: noShowPatients.length,
      cancelled: cancelledPatients.length,
      awaitingArrival,
      currentlyConsulting: doctorActiveCall,
      nextPatient,
      subSlots,
      activeQueue,
      completedPatients,
      noShowPatients,
      cancelledPatients,
    });
  }

  serializedAll.sort((a, b) => {
    const timeDiff =
      new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
    if (timeDiff !== 0) return timeDiff;
    const docDiff = a.doctorName.localeCompare(b.doctorName);
    if (docDiff !== 0) return docDiff;
    const tokenDiff =
      (a.tokenNumber ?? Number.MAX_SAFE_INTEGER) -
      (b.tokenNumber ?? Number.MAX_SAFE_INTEGER);
    if (tokenDiff !== 0) return tokenDiff;
    return a.patientName.localeCompare(b.patientName);
  });

  const doctors = Array.from(doctorsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  doctorQueues.sort((a, b) => a.doctorName.localeCompare(b.doctorName));

  const overview: ReceptionistDashboardOverview = {
    totalAppointmentsToday: serializedAll.filter(
      (a) =>
        a.status !== AppointmentStatus.CANCELLED &&
        a.status !== AppointmentStatus.PENDING_PAYMENT
    ).length,
    checkedInPatients: serializedAll.filter((a) => a.isCheckedIn).length,
    waitingPatients: serializedAll.filter(
      (a) => a.status === AppointmentStatus.CHECKED_IN
    ).length,
    calledPatients: serializedAll.filter(
      (a) => a.status === AppointmentStatus.CALLED
    ).length,
    inConsultation: serializedAll.filter(
      (a) =>
        a.status === AppointmentStatus.CALLED ||
        a.status === AppointmentStatus.IN_CONSULTATION
    ).length,
    completedConsultations: serializedAll.filter(
      (a) => a.status === AppointmentStatus.COMPLETED
    ).length,
    noShowPatients: serializedAll.filter(
      (a) => a.status === AppointmentStatus.NO_SHOW
    ).length,
    awaitingArrival: serializedAll.filter(
      (a) => a.status === AppointmentStatus.CONFIRMED
    ).length,
    cancelledAppointments: serializedAll.filter(
      (a) => a.status === AppointmentStatus.CANCELLED
    ).length,
    paymentHoldAppointments: serializedAll.filter(
      (a) => a.status === AppointmentStatus.PENDING_PAYMENT
    ).length,
  };

  return {
    todayDateIST: selectedDateIST,
    selectedDateIST,
    isSelectedDateToday: selectedDateIST === actualTodayIST,
    overview,
    appointments: serializedAll,
    doctors,
    doctorQueues,
    calledNotifications,
  };
}

/**
 * Filters serialized receptionist appointments by patient name, appointment/token lookup,
 * assigned doctor, sub-slot, appointment status, and check-in status.
 */
export function filterReceptionistAppointments(
  appointments: SerializedReceptionistAppointment[],
  filters: ReceptionistFilterOptions
): SerializedReceptionistAppointment[] {
  const query = filters.search.trim().toLowerCase();
  const normalizedTokenQuery = query.startsWith("#") ? query.slice(1) : query;

  return appointments.filter((appt) => {
    if (filters.doctorId !== "ALL" && appt.doctorId !== filters.doctorId) {
      return false;
    }

    if (
      filters.subSlotScopeKey &&
      filters.subSlotScopeKey !== "ALL" &&
      appt.queueScopeKey !== filters.subSlotScopeKey
    ) {
      return false;
    }

    if (
      filters.appointmentStatus !== "ALL" &&
      appt.status !== filters.appointmentStatus
    ) {
      return false;
    }

    if (
      filters.checkInStatus === "CHECKED_IN" &&
      !appt.isCheckedIn
    ) {
      return false;
    }
    if (
      filters.checkInStatus === "NOT_CHECKED_IN" &&
      appt.isCheckedIn
    ) {
      return false;
    }

    if (query) {
      const matchesName = appt.patientName.toLowerCase().includes(query);
      const matchesId =
        appt.id.toLowerCase().includes(query) ||
        appt.referenceCode.toLowerCase().includes(normalizedTokenQuery);
      const matchesContact = appt.contact.toLowerCase().includes(query);
      const matchesToken =
        appt.tokenNumber !== null &&
        (String(appt.tokenNumber) === normalizedTokenQuery ||
          appt.tokenLabel.toLowerCase() === query);

      if (!matchesName && !matchesId && !matchesContact && !matchesToken) {
        return false;
      }
    }

    return true;
  });
}
