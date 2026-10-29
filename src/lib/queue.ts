import { AppointmentStatus } from "@/generated/prisma/enums";

export const EMERGENCY_DISCLAIMER =
  "For medical emergencies, contact your hospital's emergency line. Do not use this app for emergencies.";

export interface QueueAppointmentItem {
  id: string;
  status: AppointmentStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  checkedInAt?: Date | null;
}

export interface EstimatedQueueItem {
  id: string;
  status: AppointmentStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
  expectedStart: Date;
  expectedEnd: Date;
  delayMinutes: number; // raw delay in minutes
  roundedDelayMinutes: number; // approximate rounded to nearest 5 min
  queuePosition: number; // 1-based index in remaining queue
  isCurrent: boolean; // currently IN_CONSULTATION
}

export interface QueueSummary {
  waiting: number; // CHECKED_IN
  inProgress: number; // IN_CONSULTATION
  completed: number; // COMPLETED today
  remaining: number; // CONFIRMED + CHECKED_IN + IN_CONSULTATION
  runningBehindMinutes: number; // delay of the doctor today (rounded to 5 min)
}

/**
 * Rounds a delay in minutes to the nearest 5 minutes for approximate user display.
 */
export function roundToNearest5Minutes(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round(minutes / 5) * 5;
}

/**
 * Calculates estimated start times, end times, and delays for a doctor's appointments on a single day.
 *
 * Algorithm Rules (Promt5.md & Amendment 6):
 * 1. Takes slot length directly from each availability's own (endTime - startTime).
 * 2. Skips terminal statuses: CANCELLED, NO_SHOW, COMPLETED.
 * 3. If an appointment is IN_CONSULTATION:
 *      expectedEnd = max(now, actualStartAt + slotDuration)
 * 4. Each subsequent appointment:
 *      expectedStart = max(scheduledStart, previousExpectedEnd)
 *      expectedEnd = expectedStart + slotDuration
 *      delay = expectedStart - scheduledStart
 * 5. If previous slot is past and nothing is in progress, previous expectedEnd is its scheduled end, not now.
 * 6. Patients not yet checked in still receive an estimate.
 */
export function calculateQueueEstimates(
  appointments: QueueAppointmentItem[],
  now: Date = new Date()
): Map<string, EstimatedQueueItem> {
  const estimates = new Map<string, EstimatedQueueItem>();

  // Filter out terminal statuses and sort strictly by scheduledStart
  const activeAppointments = appointments
    .filter(
      (a) =>
        a.status !== AppointmentStatus.CANCELLED &&
        a.status !== AppointmentStatus.NO_SHOW &&
        a.status !== AppointmentStatus.COMPLETED
    )
    .sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());

  if (activeAppointments.length === 0) {
    return estimates;
  }

  let previousExpectedEnd: Date | null = null;
  let queuePosCounter = 1;

  for (const appt of activeAppointments) {
    const slotDurationMs = appt.scheduledEnd.getTime() - appt.scheduledStart.getTime();

    if (appt.status === AppointmentStatus.IN_CONSULTATION) {
      const actualStart = appt.actualStartAt ?? appt.scheduledStart;
      const expectedEndMs = Math.max(now.getTime(), actualStart.getTime() + slotDurationMs);
      const expectedEnd = new Date(expectedEndMs);

      // Delay if consultation is running past expected end
      const overrunMs = Math.max(0, now.getTime() - (actualStart.getTime() + slotDurationMs));
      const delayMin = Math.round(overrunMs / (60 * 1000));

      estimates.set(appt.id, {
        id: appt.id,
        status: appt.status,
        scheduledStart: appt.scheduledStart,
        scheduledEnd: appt.scheduledEnd,
        expectedStart: actualStart,
        expectedEnd,
        delayMinutes: delayMin,
        roundedDelayMinutes: roundToNearest5Minutes(delayMin),
        queuePosition: queuePosCounter++,
        isCurrent: true,
      });

      previousExpectedEnd = expectedEnd;
    } else {
      // CONFIRMED, CHECKED_IN, PENDING
      let expectedStartMs: number;

      if (!previousExpectedEnd) {
        // Nothing in progress before this.
        // If scheduledStart is in the past and no consultation has started,
        // rule 5 states: if previous slot is past and nothing is in progress,
        // previous expectedEnd is scheduled end. For the first slot if past, start is scheduledStart.
        expectedStartMs = appt.scheduledStart.getTime();
      } else {
        expectedStartMs = Math.max(appt.scheduledStart.getTime(), previousExpectedEnd.getTime());
      }

      const expectedEndMs = expectedStartMs + slotDurationMs;
      const delayMs = Math.max(0, expectedStartMs - appt.scheduledStart.getTime());
      const delayMin = Math.round(delayMs / (60 * 1000));

      estimates.set(appt.id, {
        id: appt.id,
        status: appt.status,
        scheduledStart: appt.scheduledStart,
        scheduledEnd: appt.scheduledEnd,
        expectedStart: new Date(expectedStartMs),
        expectedEnd: new Date(expectedEndMs),
        delayMinutes: delayMin,
        roundedDelayMinutes: roundToNearest5Minutes(delayMin),
        queuePosition: queuePosCounter++,
        isCurrent: false,
      });

      previousExpectedEnd = new Date(expectedEndMs);
    }
  }

  return estimates;
}

/**
 * Calculates high-level summary metrics for the doctor's queue display.
 */
export function calculateQueueSummary(
  appointments: QueueAppointmentItem[],
  estimates: Map<string, EstimatedQueueItem>
): QueueSummary {
  let waiting = 0;
  let inProgress = 0;
  let completed = 0;
  let remaining = 0;
  let maxDelay = 0;

  for (const appt of appointments) {
    if (appt.status === AppointmentStatus.CHECKED_IN) {
      waiting++;
      remaining++;
    } else if (appt.status === AppointmentStatus.IN_CONSULTATION) {
      inProgress++;
      remaining++;
    } else if (appt.status === AppointmentStatus.COMPLETED) {
      completed++;
    } else if (appt.status === AppointmentStatus.CONFIRMED || appt.status === AppointmentStatus.PENDING) {
      remaining++;
    }

    const est = estimates.get(appt.id);
    if (est && est.delayMinutes > maxDelay) {
      maxDelay = est.delayMinutes;
    }
  }

  return {
    waiting,
    inProgress,
    completed,
    remaining,
    runningBehindMinutes: roundToNearest5Minutes(maxDelay),
  };
}
