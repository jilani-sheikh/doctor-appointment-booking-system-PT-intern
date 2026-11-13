import { getISTDateString, parseISTDateTime } from "@/lib/time";
import { rupeesToPaise } from "@/lib/money";

export type ScheduleType = "WAVE" | "STREAM";
export type Recurrence = "ONCE" | "RECURRING";

export const SCHEDULE_TYPE_LABELS = {
  WAVE: "Wave",
  STREAM: "Stream",
} as const;

export const RECURRENCE_LABELS = {
  ONCE: "Non-recurring",
  RECURRING: "Recurring",
} as const;

export interface ScheduleInput {
  type: ScheduleType;
  recurrence: Recurrence;
  startDate: string;
  endDate: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  capacity: number;
}

export interface GeneratedAvailability {
  date: string;
  kind: "WAVE_PARENT" | "WAVE_SLOT" | "STREAM_WINDOW";
  startTime: Date;
  endTime: Date;
  capacity: number;
  parentIndex?: number;
}

export interface ScheduleDatePlan {
  date: string;
  overrideRecurringScheduleId?: string;
  skipForNonRecurringScheduleId?: string;
}

export type ElasticEdge = "START" | "END";
export type ElasticOperation = "SHRINK" | "EXPAND";

export interface ElasticRange {
  startTime: Date;
  endTime: Date;
}

export interface AvailabilityIntervalDiff {
  added: ElasticRange[];
  removed: ElasticRange[];
}

export function calculateElasticRange(
  range: ElasticRange,
  edge: ElasticEdge,
  steps: number,
  durationMinutes: number,
  operation: ElasticOperation
): ElasticRange {
  if (!Number.isInteger(steps) || steps < 1) throw new Error("Steps must be a positive whole number.");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
    throw new Error("Duration must be a positive whole number.");
  }
  const delta = steps * durationMinutes * 60_000;
  const next = {
    startTime: new Date(range.startTime),
    endTime: new Date(range.endTime),
  };
  if (operation === "SHRINK") {
    if (edge === "START") next.startTime = new Date(next.startTime.getTime() + delta);
    else next.endTime = new Date(next.endTime.getTime() - delta);
  } else if (edge === "START") {
    next.startTime = new Date(next.startTime.getTime() - delta);
  } else {
    next.endTime = new Date(next.endTime.getTime() + delta);
  }
  if (next.endTime <= next.startTime) throw new Error("The window must keep at least one interval.");
  return next;
}

export function diffAvailabilityIntervals(
  current: ElasticRange,
  next: ElasticRange,
  durationMinutes: number
): AvailabilityIntervalDiff {
  const step = durationMinutes * 60_000;
  if (step <= 0 || !Number.isInteger(durationMinutes)) throw new Error("Duration must be a positive whole number.");
  const added: ElasticRange[] = [];
  const removed: ElasticRange[] = [];
  if (next.startTime < current.startTime) {
    for (let start = next.startTime.getTime(); start < current.startTime.getTime(); start += step) {
      added.push({ startTime: new Date(start), endTime: new Date(Math.min(start + step, current.startTime.getTime())) });
    }
  } else if (next.startTime > current.startTime) {
    for (let start = current.startTime.getTime(); start < next.startTime.getTime(); start += step) {
      removed.push({ startTime: new Date(start), endTime: new Date(start + step) });
    }
  }
  if (next.endTime > current.endTime) {
    for (let start = current.endTime.getTime(); start < next.endTime.getTime(); start += step) {
      added.push({ startTime: new Date(start), endTime: new Date(start + step) });
    }
  } else if (next.endTime < current.endTime) {
    for (let start = next.endTime.getTime(); start < current.endTime.getTime(); start += step) {
      removed.push({ startTime: new Date(start), endTime: new Date(start + step) });
    }
  }
  return { added, removed };
}

export function planScheduleDates(
  input: ScheduleInput,
  dates: string[],
  recurringScheduleIdsByDate: Record<string, string[]>,
  nonRecurringScheduleIdsByDate: Record<string, string[]>
): ScheduleDatePlan[] {
  return dates.map((date) => {
    const recurring = recurringScheduleIdsByDate[date] ?? [];
    const nonRecurring = nonRecurringScheduleIdsByDate[date] ?? [];
    if (input.recurrence === "ONCE" && recurring.length > 0) {
      return { date, overrideRecurringScheduleId: recurring[0] };
    }
    if (input.recurrence === "RECURRING" && nonRecurring.length > 0) {
      return { date, skipForNonRecurringScheduleId: nonRecurring[0] };
    }
    return { date };
  });
}

export function generatedScheduleDates(input: ScheduleInput, todayDate: string): string[] {
  return [...new Set(generateScheduleAvailabilities(input, todayDate).map((row) => row.date))];
}

export function shouldRestoreRecurringDate(otherScheduleCount: number, bookedRowCount: number): boolean {
  return otherScheduleCount === 0 && bookedRowCount === 0;
}

export function scheduleDateRelationship(
  newRecurrence: Recurrence,
  existingRecurrence: Recurrence,
  isSameDate: boolean
): "OVERRIDE" | "SKIP" | "CONFLICT" | "NONE" {
  if (!isSameDate) return "NONE";
  if (newRecurrence === "ONCE" && existingRecurrence === "RECURRING") return "OVERRIDE";
  if (newRecurrence === "RECURRING" && existingRecurrence === "ONCE") return "SKIP";
  return "CONFLICT";
}

export function overrideRequiresConfirmation(activeAppointmentCount: number, confirmed: boolean): boolean {
  return activeAppointmentCount > 0 && !confirmed;
}

function dateToOrdinal(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function ordinalToDate(ordinal: number): string {
  const date = new Date(ordinal * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function validateScheduleInput(input: ScheduleInput, todayDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    return "Dates must use YYYY-MM-DD format.";
  }
  if (input.startDate < todayDate) return "Start date cannot be in the past.";
  if (input.endDate < input.startDate) return "End date must be on or after start date.";
  if (input.recurrence === "RECURRING" && input.daysOfWeek.length === 0) {
    return "Recurring schedules require at least one weekday.";
  }
  if (input.recurrence === "RECURRING" && dateToOrdinal(input.endDate) - dateToOrdinal(input.startDate) > 89) {
    return "Recurring schedules cannot exceed 90 days.";
  }
  if (input.startMinute < 0 || input.endMinute > 1440 || input.endMinute <= input.startMinute) {
    return "End time must be after start time.";
  }
  const windowMinutes = input.endMinute - input.startMinute;
  if (input.type === "WAVE") {
    if (input.durationMinutes <= 0 || !Number.isInteger(input.durationMinutes)) {
      return "Duration must be a positive whole number of minutes.";
    }
    if (windowMinutes % input.durationMinutes !== 0) {
      return "The schedule window must be divisible by the duration.";
    }
  }
  if (input.capacity <= 0 || !Number.isInteger(input.capacity)) return "Capacity must be a positive whole number.";
  return null;
}

export function generateScheduleAvailabilities(
  input: ScheduleInput,
  todayDate: string
): GeneratedAvailability[] {
  const validationError = validateScheduleInput(input, todayDate);
  if (validationError) throw new Error(validationError);

  const dates: string[] = [];
  const start = dateToOrdinal(input.startDate);
  const end = input.recurrence === "ONCE" ? start : dateToOrdinal(input.endDate);
  for (let ordinal = start; ordinal <= end; ordinal += 1) {
    const date = ordinalToDate(ordinal);
    if (input.recurrence === "ONCE" || input.daysOfWeek.includes(weekday(date))) dates.push(date);
  }

  const rows: GeneratedAvailability[] = [];
  for (const date of dates) {
    const windowStart = parseISTDateTime(
      date,
      `${String(Math.floor(input.startMinute / 60)).padStart(2, "0")}:${String(input.startMinute % 60).padStart(2, "0")}`
    );
    const windowEnd = parseISTDateTime(
      date,
      `${String(Math.floor(input.endMinute / 60)).padStart(2, "0")}:${String(input.endMinute % 60).padStart(2, "0")}`
    );

    if (input.type === "STREAM") {
      rows.push({ date, kind: "STREAM_WINDOW", startTime: windowStart, endTime: windowEnd, capacity: input.capacity });
      continue;
    }

    const intervalCount = (input.endMinute - input.startMinute) / input.durationMinutes;
    const parentIndex = rows.length;
    rows.push({ date, kind: "WAVE_PARENT", startTime: windowStart, endTime: windowEnd, capacity: input.capacity });
    for (let index = 0; index < intervalCount; index += 1) {
      const startMinute = input.startMinute + index * input.durationMinutes;
      const endMinute = startMinute + input.durationMinutes;
      rows.push({
        date,
        kind: "WAVE_SLOT",
        startTime: parseISTDateTime(
          date,
          `${String(Math.floor(startMinute / 60)).padStart(2, "0")}:${String(startMinute % 60).padStart(2, "0")}`
        ),
        endTime: parseISTDateTime(
          date,
          `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`
        ),
        capacity: input.capacity,
        parentIndex,
      });
    }
  }
  return rows;
}

export function effectiveSlot(appointment: {
  slotStart?: Date | null;
  slotEnd?: Date | null;
  availability?: { startTime: Date; endTime?: Date } | null;
}): { start: Date; end: Date } {
  const start = appointment.slotStart ?? appointment.availability?.startTime;
  if (!start) throw new Error("Appointment is missing an effective start time.");
  return {
    start,
    end: appointment.slotEnd ?? appointment.availability?.endTime ?? start,
  };
}

export interface AlternativeSlotSuggestion {
  id: string;
  doctorId: string;
  doctorName: string;
  specialization: string;
  startTime: string;
  endTime: string;
  kind: "SINGLE" | "WAVE_SLOT" | "STREAM_WINDOW";
  capacity: number;
  activeCount: number;
}

export interface ThreeLevelAlternativeSuggestions {
  sameDayAlternatives: AlternativeSlotSuggestion[];
  upcomingDateAlternatives: AlternativeSlotSuggestion[];
  otherDoctorAlternatives: AlternativeSlotSuggestion[];
}

export interface AlternativeSlotCandidate {
  id: string;
  doctorId: string;
  doctorName: string;
  specialization: string;
  consultationFeeRupees?: number;
  startTime: Date;
  endTime: Date;
  status: "AVAILABLE" | "BOOKED" | "BLOCKED";
  kind: "SINGLE" | "WAVE_PARENT" | "WAVE_SLOT" | "STREAM_WINDOW";
  capacity: number;
  activeCount: number;
  parentStartTime?: Date | null;
  parentEndTime?: Date | null;
  parentStatus?: "AVAILABLE" | "BOOKED" | "BLOCKED" | null;
  blockedByTimeOffId?: string | null;
}

export interface SelectAlternativesInput {
  originalAppointment: {
    availabilityId: string;
    doctorId: string;
    specialization: string;
    startTime: Date;
    endTime: Date;
    kind: "SINGLE" | "WAVE_SLOT" | "STREAM_WINDOW";
    consultationFeeRupees?: number;
  };
  candidates: AlternativeSlotCandidate[];
  timeOffs?: Array<{ doctorId: string; startAt: Date; endAt: Date }>;
  patientActiveSlots?: Array<{ availabilityId: string; doctorId: string; startTime: Date; endTime: Date }>;
  minStartTime: Date;
  maxPerCategory?: number;
  allowOtherClinicDoctors?: boolean;
}

export interface CrossDoctorPaymentCheckInput {
  originalDoctorFeeRupees: number;
  targetDoctorFeeRupees: number;
  payments: Array<{
    status: string;
    amountRupees: number;
    needsAttention?: boolean;
  }>;
  refundCount: number;
  paymentsMode: "disabled" | "cashfree";
}

/**
 * Verifies whether moving an appointment to another approved doctor preserves
 * payment ledger consistency. Equal current consultation fees alone are insufficient:
 * - Both doctors' fees in integer paise must match.
 * - The appointment must have no existing refunds, no payments flagged for attention,
 *   and no in-flight CREATED payment orders.
 * - If paid, there must be a single PAID payment whose recorded amount in paise
 *   matches the target doctor's fee (protecting against post-booking fee changes).
 * - If unpaid, either paymentsMode is "disabled" or the target consultation is free (0 paise).
 */
export function isCrossDoctorPaymentCompatible(input: CrossDoctorPaymentCheckInput): boolean {
  const originalFeePaise = rupeesToPaise(input.originalDoctorFeeRupees);
  const targetFeePaise = rupeesToPaise(input.targetDoctorFeeRupees);

  if (originalFeePaise !== targetFeePaise) {
    return false;
  }

  if (input.refundCount > 0) {
    return false;
  }

  if (input.payments.some((p) => p.needsAttention || p.status === "CREATED")) {
    return false;
  }

  const paidPayments = input.payments.filter((p) => p.status === "PAID");
  if (paidPayments.length > 1) {
    return false;
  }

  if (paidPayments.length === 1) {
    const paidAmountPaise = rupeesToPaise(paidPayments[0]!.amountRupees);
    return paidAmountPaise === targetFeePaise;
  }

  // Unpaid appointment: only compatible if payments are disabled or target consultation is free
  if (input.paymentsMode !== "disabled" && targetFeePaise > 0) {
    return false;
  }

  return true;
}

/**
 * Pure three-level alternative appointment discovery and grouping helper:
 * Priority 1: Remaining compatible slots on the same IST day with the same doctor.
 * Priority 2: Other upcoming dates with the same doctor (closest to original appointment).
 * Priority 3: Other approved doctors in the same clinic/specialization when Priority 1 + Priority 2
 *             return fewer than the desired number of suggestions (maxPerCategory).
 */
export function selectThreeLevelAlternatives(input: SelectAlternativesInput): ThreeLevelAlternativeSuggestions {
  const {
    originalAppointment,
    candidates,
    timeOffs = [],
    patientActiveSlots = [],
    minStartTime,
    maxPerCategory = 3,
    allowOtherClinicDoctors = true,
  } = input;

  const originalDateIST = getISTDateString(originalAppointment.startTime);
  const originalStartMs = originalAppointment.startTime.getTime();
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  const validCandidates: Array<AlternativeSlotCandidate & { kind: "SINGLE" | "WAVE_SLOT" | "STREAM_WINDOW" }> = [];

  for (const candidate of candidates) {
    if (candidate.id === originalAppointment.availabilityId) continue;
    if (candidate.kind === "WAVE_PARENT") continue;
    if (candidate.status !== "AVAILABLE") continue;
    if (candidate.activeCount >= candidate.capacity) continue;
    if (candidate.blockedByTimeOffId) continue;
    if (candidate.startTime <= minStartTime) continue;

    // Ensure Wave child slot still falls inside its parent's current range (not shrunk/removed)
    if (candidate.kind === "WAVE_SLOT" && candidate.parentStartTime && candidate.parentEndTime) {
      if (
        candidate.startTime < candidate.parentStartTime ||
        candidate.endTime > candidate.parentEndTime ||
        candidate.parentStatus === "BLOCKED"
      ) {
        continue;
      }
    }

    // Check scheduling-type compatibility
    if (originalAppointment.kind === "STREAM_WINDOW") {
      if (candidate.kind !== "STREAM_WINDOW") continue;
    } else {
      if (candidate.kind !== "WAVE_SLOT" && candidate.kind !== "SINGLE") continue;
    }

    // Check doctor time-off restrictions
    const overlapsTimeOff = timeOffs.some(
      (to) =>
        to.doctorId === candidate.doctorId &&
        to.startAt < candidate.endTime &&
        to.endAt > candidate.startTime
    );
    if (overlapsTimeOff) continue;

    // Check patient appointment conflicts (time overlap or same-doctor same-IST-date limit)
    const candidateDateIST = getISTDateString(candidate.startTime);
    const hasPatientConflict = patientActiveSlots.some((active) => {
      const overlapsTime =
        active.startTime < candidate.endTime && active.endTime > candidate.startTime;
      const sameDoctorSameDay =
        active.doctorId === candidate.doctorId &&
        getISTDateString(active.startTime) === candidateDateIST;
      return overlapsTime || sameDoctorSameDay;
    });
    if (hasPatientConflict) continue;

    const dedupeKey = `${candidate.doctorId}:${candidate.startTime.getTime()}:${candidate.endTime.getTime()}:${candidate.kind}`;
    if (seenIds.has(candidate.id) || seenKeys.has(dedupeKey)) continue;
    seenIds.add(candidate.id);
    seenKeys.add(dedupeKey);

    validCandidates.push(candidate as AlternativeSlotCandidate & { kind: "SINGLE" | "WAVE_SLOT" | "STREAM_WINDOW" });
  }

  const toSuggestion = (
    c: AlternativeSlotCandidate & { kind: "SINGLE" | "WAVE_SLOT" | "STREAM_WINDOW" }
  ): AlternativeSlotSuggestion => ({
    id: c.id,
    doctorId: c.doctorId,
    doctorName: c.doctorName,
    specialization: c.specialization,
    startTime: c.startTime.toISOString(),
    endTime: c.endTime.toISOString(),
    kind: c.kind,
    capacity: c.capacity,
    activeCount: c.activeCount,
  });

  const sortByCloseness = <T extends { startTime: Date }>(list: T[]): T[] =>
    [...list].sort((a, b) => {
      const diffA = Math.abs(a.startTime.getTime() - originalStartMs);
      const diffB = Math.abs(b.startTime.getTime() - originalStartMs);
      if (diffA !== diffB) return diffA - diffB;
      return a.startTime.getTime() - b.startTime.getTime();
    });

  // Priority 1: Remaining slots on the same day with the same doctor
  const sameDayPool = sortByCloseness(
    validCandidates.filter(
      (c) =>
        c.doctorId === originalAppointment.doctorId &&
        getISTDateString(c.startTime) === originalDateIST
    )
  )
    .slice(0, maxPerCategory)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const sameDayAlternatives = sameDayPool.map(toSuggestion);

  // Priority 2: Other upcoming dates with the same doctor
  const upcomingPool = sortByCloseness(
    validCandidates.filter(
      (c) =>
        c.doctorId === originalAppointment.doctorId &&
        getISTDateString(c.startTime) !== originalDateIST
    )
  )
    .slice(0, maxPerCategory)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const upcomingDateAlternatives = upcomingPool.map(toSuggestion);

  // Priority 3: Other doctors in the same clinic/specialization when Priority 1 + Priority 2
  // return fewer than the desired number of suggestions (maxPerCategory)
  let otherDoctorAlternatives: AlternativeSlotSuggestion[] = [];
  if (
    allowOtherClinicDoctors &&
    sameDayAlternatives.length + upcomingDateAlternatives.length < maxPerCategory
  ) {
    const otherDoctorPool = sortByCloseness(
      validCandidates.filter((c) => {
        if (c.doctorId === originalAppointment.doctorId) return false;
        if (c.specialization.toLowerCase() !== originalAppointment.specialization.toLowerCase()) {
          return false;
        }
        if (
          originalAppointment.consultationFeeRupees !== undefined &&
          c.consultationFeeRupees !== undefined &&
          rupeesToPaise(originalAppointment.consultationFeeRupees) !==
            rupeesToPaise(c.consultationFeeRupees)
        ) {
          return false;
        }
        return true;
      })
    )
      .slice(0, maxPerCategory)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    otherDoctorAlternatives = otherDoctorPool.map(toSuggestion);
  }

  return {
    sameDayAlternatives,
    upcomingDateAlternatives,
    otherDoctorAlternatives,
  };
}

export interface VisibleAlternativeCategory {
  key: "sameDay" | "upcomingDate" | "otherDoctor";
  priority: 1 | 2 | 3;
  title: string;
  showDoctor: boolean;
  items: AlternativeSlotSuggestion[];
}

/**
 * Determines whether an upcoming appointment should display the inline disrupted-appointment
 * alternatives section on the Patient Dashboard / Consultations view:
 * - disruptedAt is not null
 * - rescheduleStatus === "PENDING_RESCHEDULING"
 * - appointment is still active (PENDING or CONFIRMED) and in the future
 */
export function isEligibleForDisruptedDashboardAlternatives(
  appt: {
    status: string;
    startTime: Date | string;
    disruptedAt?: Date | string | null;
    rescheduleStatus?: string | null;
  },
  now: Date = new Date()
): boolean {
  if (!appt.disruptedAt) return false;
  if (appt.rescheduleStatus !== "PENDING_RESCHEDULING") return false;
  if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") return false;
  const startMs =
    appt.startTime instanceof Date ? appt.startTime.getTime() : new Date(appt.startTime).getTime();
  return startMs > now.getTime();
}

/**
 * Returns only the non-empty alternative categories in strict three-level priority order:
 * 1. Same-day appointments with the same doctor
 * 2. Upcoming appointments with the same doctor
 * 3. Appointments with other eligible doctors at the same clinic
 */
export function getVisibleAlternativeCategories(
  alternatives?: ThreeLevelAlternativeSuggestions | null
): VisibleAlternativeCategory[] {
  if (!alternatives) return [];

  const allCategories: VisibleAlternativeCategory[] = [
    {
      key: "sameDay",
      priority: 1,
      title: "1. Same-Day Appointments with Your Doctor",
      showDoctor: false,
      items: alternatives.sameDayAlternatives ?? [],
    },
    {
      key: "upcomingDate",
      priority: 2,
      title: "2. Upcoming Appointments with Your Doctor",
      showDoctor: false,
      items: alternatives.upcomingDateAlternatives ?? [],
    },
    {
      key: "otherDoctor",
      priority: 3,
      title: "3. Appointments with Other Eligible Doctors at the Clinic",
      showDoctor: true,
      items: alternatives.otherDoctorAlternatives ?? [],
    },
  ];

  return allCategories.filter((category) => category.items.length > 0);
}

const ELASTIC_ACTIVE_APPOINTMENT_STATUSES = new Set<string>([
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_CONSULTATION",
  "PENDING_PAYMENT",
]);

export interface ElasticAppointmentCandidate {
  id: string;
  patientUserId: string;
  status: string;
  slotStart?: Date | null;
  slotEnd?: Date | null;
  slotStartTime?: Date;
  slotEndTime?: Date;
}

export interface IdentifiedAffectedElasticAppointment {
  id: string;
  patientUserId: string;
  originalStartTime: Date;
  originalEndTime: Date;
  isStreamWindow: boolean;
  newStartTime?: Date;
  newEndTime?: Date;
  operation: ElasticOperation;
  disruptionReason: string;
}

/**
 * Identifies booked appointments genuinely affected by an Elastic SHRINK or EXPAND operation:
 * - WAVE + SHRINK: active appointments in child subslots overlapping removedIntervals.
 * - WAVE + EXPAND: existing child subslots retain their fixed [startTime, endTime]; only appointments
 *   falling outside nextRange would be affected (standard Wave expand affects 0 existing bookings).
 * - STREAM + SHRINK: active Stream appointments without fixed subslot times (or overlapping removedIntervals)
 *   whose continuous window was shortened.
 * - STREAM + EXPAND: active Stream appointments without fixed subslot times (slotStart == null || slotEnd == null)
 *   whose effective consultation window [previousRange.startTime, previousRange.endTime] changed to nextRange.
 */
export function identifyAffectedElasticAppointments(params: {
  operation: ElasticOperation;
  scheduleType: "WAVE" | "STREAM";
  previousRange: { startTime: Date; endTime: Date };
  nextRange: { startTime: Date; endTime: Date };
  removedIntervals?: Array<{ startTime: Date; endTime: Date }>;
  appointments: ElasticAppointmentCandidate[];
}): IdentifiedAffectedElasticAppointment[] {
  const {
    operation,
    scheduleType,
    previousRange,
    nextRange,
    removedIntervals = [],
    appointments,
  } = params;

  const rangeChanged =
    previousRange.startTime.getTime() !== nextRange.startTime.getTime() ||
    previousRange.endTime.getTime() !== nextRange.endTime.getTime();

  if (!rangeChanged) {
    return [];
  }

  const affected: IdentifiedAffectedElasticAppointment[] = [];

  for (const appt of appointments) {
    if (!ELASTIC_ACTIVE_APPOINTMENT_STATUSES.has(appt.status)) {
      continue;
    }

    if (scheduleType === "WAVE") {
      const effectiveStart = appt.slotStart ?? appt.slotStartTime ?? previousRange.startTime;
      const effectiveEnd = appt.slotEnd ?? appt.slotEndTime ?? previousRange.endTime;

      const overlapsRemoved = removedIntervals.some(
        (interval) =>
          effectiveStart < interval.endTime && effectiveEnd > interval.startTime
      );
      const outsideNextRange =
        effectiveStart < nextRange.startTime || effectiveEnd > nextRange.endTime;

      if ((operation === "SHRINK" && (overlapsRemoved || outsideNextRange)) ||
          (operation === "EXPAND" && outsideNextRange)) {
        affected.push({
          id: appt.id,
          patientUserId: appt.patientUserId,
          originalStartTime: effectiveStart,
          originalEndTime: effectiveEnd,
          isStreamWindow: false,
          operation,
          disruptionReason:
            operation === "SHRINK"
              ? "Doctor availability was reduced. Please select an alternative consultation time."
              : "Doctor availability window was updated. Please select an alternative consultation time.",
        });
      }
      continue;
    }

    // STREAM schedule
    const hasFixedSubslot = Boolean(appt.slotStart && appt.slotEnd);
    if (!hasFixedSubslot) {
      affected.push({
        id: appt.id,
        patientUserId: appt.patientUserId,
        originalStartTime: previousRange.startTime,
        originalEndTime: previousRange.endTime,
        isStreamWindow: true,
        newStartTime: nextRange.startTime,
        newEndTime: nextRange.endTime,
        operation,
        disruptionReason:
          operation === "SHRINK"
            ? "Doctor's continuous consultation window was shortened. Because Stream bookings do not have individual sub-slot times, your appointment was flagged in case the updated window hours no longer work for you. Your seat remains protected, or you may reschedule."
            : "Doctor's continuous consultation window was expanded and updated. Because Stream bookings do not have individual sub-slot times, your appointment was flagged in case the updated window hours no longer work for you. Your seat remains protected, or you may reschedule.",
      });
    } else {
      const overlapsRemoved = removedIntervals.some(
        (interval) =>
          appt.slotStart! < interval.endTime && appt.slotEnd! > interval.startTime
      );
      const outsideNextRange =
        appt.slotStart! < nextRange.startTime || appt.slotEnd! > nextRange.endTime;
      if (overlapsRemoved || outsideNextRange) {
        affected.push({
          id: appt.id,
          patientUserId: appt.patientUserId,
          originalStartTime: appt.slotStart!,
          originalEndTime: appt.slotEnd!,
          isStreamWindow: true,
          newStartTime: nextRange.startTime,
          newEndTime: nextRange.endTime,
          operation,
          disruptionReason:
            operation === "SHRINK"
              ? "Doctor's continuous consultation window was shortened. Please select an alternative consultation time."
              : "Doctor's continuous consultation window was updated. Please select an alternative consultation time.",
        });
      }
    }
  }

  return affected;
}

/**
 * Generates a deterministic deduplication key for an Elastic Scheduling rescheduling notification
 * so duplicate processing of the same schedule adjustment never sends duplicate emails.
 */
export function buildElasticRescheduleDedupeKey(params: {
  appointmentId: string;
  operation: ElasticOperation;
  originalStartTime: Date | string;
  originalEndTime: Date | string;
  newStartTime?: Date | string | null;
  newEndTime?: Date | string | null;
}): string {
  const origStart =
    params.originalStartTime instanceof Date
      ? params.originalStartTime.toISOString()
      : new Date(params.originalStartTime).toISOString();
  const origEnd =
    params.originalEndTime instanceof Date
      ? params.originalEndTime.toISOString()
      : new Date(params.originalEndTime).toISOString();
  const nextStart = params.newStartTime
    ? params.newStartTime instanceof Date
      ? params.newStartTime.toISOString()
      : new Date(params.newStartTime).toISOString()
    : "none";
  const nextEnd = params.newEndTime
    ? params.newEndTime instanceof Date
      ? params.newEndTime.toISOString()
      : new Date(params.newEndTime).toISOString()
    : "none";

  return `email:elastic_${params.operation.toLowerCase()}:${params.appointmentId}:${origStart}:${origEnd}:${nextStart}:${nextEnd}`;
}

