import { VisitStream, WaveStatus, AppointmentStatus } from "@/generated/prisma/enums";
import { parseISTDateTime, formatTimeIST } from "@/lib/time";

export interface WaveAssignmentCandidate {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  specialization: string;
  slotStartTime: Date;
  slotEndTime: Date;
  stream: VisitStream;
  status: AppointmentStatus;
  checkedInAt?: Date | null;
  waveId?: string | null;
}

export interface WaveTarget {
  id: string;
  specialization: string;
  windowStart: Date;
  windowEnd: Date;
  capacity: number;
  stream?: VisitStream | null;
  status: WaveStatus;
}

export interface WaveGroupingResult {
  assignedByWaveId: Map<string, WaveAssignmentCandidate[]>;
  unassigned: WaveAssignmentCandidate[];
  overflowByWaveId: Map<string, WaveAssignmentCandidate[]>;
}

export interface WavePerformanceMetrics {
  waveId: string;
  expectedArrivals: number;
  actualCheckIns: number;
  onTimeCheckIns: number;
  lateCheckIns: number;
  noShows: number;
  notYetArrived: number;
}

/**
 * Pure function: Groups candidates into wave windows respecting specialization, time window, stream filter, and capacity.
 * Overflow appointments beyond capacity are tracked explicitly and never silently dropped.
 */
export function groupAppointmentsIntoWaves(
  candidates: WaveAssignmentCandidate[],
  waves: WaveTarget[]
): WaveGroupingResult {
  const assignedByWaveId = new Map<string, WaveAssignmentCandidate[]>();
  const overflowByWaveId = new Map<string, WaveAssignmentCandidate[]>();
  const unassigned: WaveAssignmentCandidate[] = [];

  // Initialize maps
  for (const wave of waves) {
    assignedByWaveId.set(wave.id, []);
    overflowByWaveId.set(wave.id, []);
  }

  // Sort candidates by slot start time ascending
  const sorted = [...candidates].sort(
    (a, b) => a.slotStartTime.getTime() - b.slotStartTime.getTime()
  );

  for (const candidate of sorted) {
    // Find matching wave for this candidate
    const matchingWave = waves.find((w) => {
      if (w.specialization.toLowerCase() !== candidate.specialization.toLowerCase()) {
        return false;
      }
      // Stream match: if wave has stream specified, must match exactly
      if (w.stream && w.stream !== candidate.stream) {
        return false;
      }
      // Slot start must fall within [windowStart, windowEnd)
      const slotTime = candidate.slotStartTime.getTime();
      return slotTime >= w.windowStart.getTime() && slotTime < w.windowEnd.getTime();
    });

    if (!matchingWave) {
      unassigned.push(candidate);
      continue;
    }

    const assigned = assignedByWaveId.get(matchingWave.id)!;
    if (assigned.length < matchingWave.capacity) {
      assigned.push(candidate);
    } else {
      // Wave capacity full -> overflow
      overflowByWaveId.get(matchingWave.id)!.push(candidate);
      unassigned.push(candidate);
    }
  }

  return {
    assignedByWaveId,
    unassigned,
    overflowByWaveId,
  };
}

/**
 * Pure function: Deterministic auto-generation algorithm for wave windows.
 * Divides the day's active operating range into sequential windows of length `windowMinutes`.
 */
export function generateDeterministicWaveWindows(params: {
  specialization: string;
  dateStr: string; // YYYY-MM-DD (IST)
  earliestTimeStr?: string; // e.g. "09:00"
  latestTimeStr?: string; // e.g. "17:00"
  windowMinutes: number; // e.g. 60 or 120
  defaultCapacity: number; // e.g. 4
}): Array<{
  specialization: string;
  windowStart: Date;
  windowEnd: Date;
  capacity: number;
  status: WaveStatus;
}> {
  const startStr = params.earliestTimeStr ?? "09:00";
  const endStr = params.latestTimeStr ?? "17:00";
  const dayStart = parseISTDateTime(params.dateStr, startStr);
  const dayEnd = parseISTDateTime(params.dateStr, endStr);

  const windowMs = params.windowMinutes * 60 * 1000;
  const waves: Array<{
    specialization: string;
    windowStart: Date;
    windowEnd: Date;
    capacity: number;
    status: WaveStatus;
  }> = [];

  let current = dayStart.getTime();
  const finish = dayEnd.getTime();

  while (current < finish) {
    const next = Math.min(current + windowMs, finish);
    waves.push({
      specialization: params.specialization,
      windowStart: new Date(current),
      windowEnd: new Date(next),
      capacity: params.defaultCapacity,
      status: WaveStatus.DRAFT,
    });
    current = next;
  }

  return waves;
}

/**
 * Computes "expected vs actual" performance metrics for a wave.
 */
export function calculateWaveMetrics(
  wave: WaveTarget,
  assignedAppointments: Array<{
    status: AppointmentStatus;
    checkedInAt?: Date | null;
  }>
): WavePerformanceMetrics {
  let onTimeCheckIns = 0;
  let lateCheckIns = 0;
  let noShows = 0;
  let notYetArrived = 0;

  const windowEndMs = wave.windowEnd.getTime();

  for (const appt of assignedAppointments) {
    if (appt.status === AppointmentStatus.NO_SHOW) {
      noShows++;
    } else if (appt.checkedInAt) {
      const checkInMs = new Date(appt.checkedInAt).getTime();
      if (checkInMs <= windowEndMs) {
        onTimeCheckIns++;
      } else {
        lateCheckIns++;
      }
    } else if (
      appt.status === AppointmentStatus.CONFIRMED ||
      appt.status === AppointmentStatus.PENDING
    ) {
      notYetArrived++;
    }
  }

  const actualCheckIns = onTimeCheckIns + lateCheckIns;

  return {
    waveId: wave.id,
    expectedArrivals: assignedAppointments.length,
    actualCheckIns,
    onTimeCheckIns,
    lateCheckIns,
    noShows,
    notYetArrived,
  };
}

/**
 * Formats a wave's arrival window string in IST for patient display.
 * Example: "Arrive between 10:00 AM and 11:00 AM IST"
 */
export function formatWaveArrivalWindowIST(start: Date, end: Date): string {
  return `${formatTimeIST(start)} - ${formatTimeIST(end)} (IST)`;
}
