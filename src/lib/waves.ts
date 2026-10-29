import { VisitStream, WaveStatus, AppointmentStatus } from "@/generated/prisma/enums";
import { parseISTDateTime, formatTimeIST } from "@/lib/time";

export interface WaveAssignmentCandidate {
  id: string;
  patientId: string;
  patientName?: string;
  doctorId?: string;
  doctorName?: string;
  specialization?: string;
  slotStartTime: Date;
  slotEndTime: Date;
  stream?: VisitStream;
  status: AppointmentStatus;
  checkedInAt?: Date | null;
  waveId?: string | null;
}

export interface WaveTarget {
  id: string;
  specialization?: string;
  doctorId?: string | null;
  windowStart: Date;
  windowEnd: Date;
  capacity: number;
  stream?: VisitStream | null;
  status: WaveStatus;
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

export interface DoctorWaveScheduleResult {
  waves: Array<{
    windowStart: Date;
    windowEnd: Date;
    capacity: number;
    appointments: WaveAssignmentCandidate[];
  }>;
  unassigned: Array<{
    appointment: WaveAssignmentCandidate;
    reason: string;
  }>;
}

/**
 * Validates whether a manual wave window overlaps with any existing waves for that doctor on that day.
 * Rule: Overlap validation applies to MANUAL wave creation only.
 * Generated waves may legitimately overlap when the arrival buffer is longer than the gap between groups' first slots.
 */
export function validateManualWaveOverlap(
  newWave: { windowStart: Date; windowEnd: Date },
  existingWaves: Array<{ id?: string; windowStart: Date; windowEnd: Date }>,
  excludeWaveId?: string
): { valid: boolean; error?: string } {
  const newStart = newWave.windowStart.getTime();
  const newEnd = newWave.windowEnd.getTime();

  if (newStart >= newEnd) {
    return { valid: false, error: "Wave arrival window start time must be before end time." };
  }

  for (const wave of existingWaves) {
    if (excludeWaveId && wave.id === excludeWaveId) continue;
    const existingStart = wave.windowStart.getTime();
    const existingEnd = wave.windowEnd.getTime();

    // Check intersection: [newStart, newEnd) overlaps [existingStart, existingEnd)
    if (newStart < existingEnd && existingStart < newEnd) {
      return {
        valid: false,
        error: `Wave window overlaps with an existing wave (${formatTimeIST(wave.windowStart)} - ${formatTimeIST(wave.windowEnd)} IST).`,
      };
    }
  }

  return { valid: true };
}

/**
 * Generates doctor-owned wave scheduling windows over fixed consultation slots.
 *
 * Algorithm (Doctor-Owned Auto Waves):
 * 1. Filter out cancelled or no-show appointments.
 * 2. Sort candidate appointments ascending by consultation slot start time.
 * 3. Group appointments into chunks anchored at the first slot start time of each chunk,
 *    covering [chunkAnchor, chunkAnchor + windowMinutes).
 * 4. Split each chunk into waves of at most `capacity` patients.
 * 5. For each wave, calculate arrival window:
 *    - firstSlotStart = earliest appointment slot start in that wave
 *    - arrivalStart = firstSlotStart - bufferMinutes
 *    - arrivalEnd = firstSlotStart
 *    - Clamp rule: If arrivalStart < now, clamp arrivalStart = Math.min(now, arrivalEnd).
 * 6. Expired arrival window handling:
 *    - If arrivalEnd <= now:
 *      - Already CHECKED_IN (or IN_CONSULTATION/COMPLETED) patients are NOT unassigned:
 *        keep them in their wave and count them as arrived.
 *      - Only CONFIRMED (not yet checked in) patients whose window has passed go to unassigned
 *        with reason "Arrival window expired".
 *    - If a wave has 0 remaining valid appointments, discard it.
 */
export function generateDoctorWaveSchedule(params: {
  appointments: WaveAssignmentCandidate[];
  windowMinutes: number; // e.g. 30
  capacity: number; // e.g. 3
  bufferMinutes: number; // e.g. 15
  now?: Date;
}): DoctorWaveScheduleResult {
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const windowMs = params.windowMinutes * 60 * 1000;
  const bufferMs = params.bufferMinutes * 60 * 1000;

  // Filter candidates: include CONFIRMED, CHECKED_IN, IN_CONSULTATION, COMPLETED
  const activeCandidates = params.appointments.filter(
    (a) =>
      a.status !== AppointmentStatus.CANCELLED &&
      a.status !== AppointmentStatus.NO_SHOW
  );

  // Sort ascending by slotStartTime
  const sorted = [...activeCandidates].sort(
    (a, b) => a.slotStartTime.getTime() - b.slotStartTime.getTime()
  );

  if (sorted.length === 0) {
    return { waves: [], unassigned: [] };
  }

  // Group into chunks anchored by earliest appointment
  const chunks: WaveAssignmentCandidate[][] = [];
  let currentChunk: WaveAssignmentCandidate[] = [];
  let chunkAnchor: number | null = null;

  for (const appt of sorted) {
    const slotMs = appt.slotStartTime.getTime();
    if (chunkAnchor === null) {
      chunkAnchor = slotMs;
      currentChunk = [appt];
    } else if (slotMs < chunkAnchor + windowMs) {
      currentChunk.push(appt);
    } else {
      chunks.push(currentChunk);
      chunkAnchor = slotMs;
      currentChunk = [appt];
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  const waves: DoctorWaveScheduleResult["waves"] = [];
  const unassigned: DoctorWaveScheduleResult["unassigned"] = [];

  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += params.capacity) {
      const group = chunk.slice(i, i + params.capacity);
      if (group.length === 0) continue;

      const firstSlotMs = group[0].slotStartTime.getTime();
      let arrivalStartMs = firstSlotMs - bufferMs;
      const arrivalEndMs = firstSlotMs;

      // Past-window clamp: clamp arrivalStart to now if in the past
      if (arrivalStartMs < nowMs) {
        arrivalStartMs = Math.min(nowMs, arrivalEndMs);
      }

      // Check expired arrival window
      const validGroupAppts: WaveAssignmentCandidate[] = [];
      for (const appt of group) {
        const isPastWindow = arrivalEndMs <= nowMs;
        // If window passed and patient is CONFIRMED (not yet checked in) -> unassigned
        if (isPastWindow && appt.status === AppointmentStatus.CONFIRMED) {
          unassigned.push({
            appointment: appt,
            reason: "Arrival window expired",
          });
        } else {
          // Already CHECKED_IN, IN_CONSULTATION, COMPLETED or window is in future
          validGroupAppts.push(appt);
        }
      }

      if (validGroupAppts.length > 0) {
        waves.push({
          windowStart: new Date(arrivalStartMs),
          windowEnd: new Date(arrivalEndMs),
          capacity: params.capacity,
          appointments: validGroupAppts,
        });
      }
    }
  }

  return { waves, unassigned };
}

/**
 * Computes "expected vs actual" performance metrics for a wave.
 */
export function calculateWaveMetrics(
  wave: { windowEnd: Date | string },
  assignedAppointments: Array<{
    status: AppointmentStatus;
    checkedInAt?: Date | string | null;
  }>
): WavePerformanceMetrics {
  let onTimeCheckIns = 0;
  let lateCheckIns = 0;
  let noShows = 0;
  let notYetArrived = 0;

  const windowEndMs = new Date(wave.windowEnd).getTime();

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
    waveId: "",
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
 * Example: "10:00 AM - 10:30 AM (IST)"
 */
export function formatWaveArrivalWindowIST(start: Date | string, end: Date | string): string {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;
  return `${formatTimeIST(s)} - ${formatTimeIST(e)} (IST)`;
}

export interface WaveGroupingResult {
  assignedByWaveId: Map<string, WaveAssignmentCandidate[]>;
  unassigned: WaveAssignmentCandidate[];
  overflowByWaveId: Map<string, WaveAssignmentCandidate[]>;
}

/**
 * Legacy wave grouping function maintained for backward-compatibility.
 */
export function groupAppointmentsIntoWaves(
  candidates: WaveAssignmentCandidate[],
  waves: WaveTarget[]
): WaveGroupingResult {
  const assignedByWaveId = new Map<string, WaveAssignmentCandidate[]>();
  const overflowByWaveId = new Map<string, WaveAssignmentCandidate[]>();
  const unassigned: WaveAssignmentCandidate[] = [];

  for (const wave of waves) {
    assignedByWaveId.set(wave.id, []);
    overflowByWaveId.set(wave.id, []);
  }

  const sorted = [...candidates].sort(
    (a, b) => a.slotStartTime.getTime() - b.slotStartTime.getTime()
  );

  for (const candidate of sorted) {
    const matchingWave = waves.find((w) => {
      if (w.specialization && candidate.specialization && w.specialization.toLowerCase() !== candidate.specialization.toLowerCase()) {
        return false;
      }
      if (w.stream && candidate.stream && w.stream !== candidate.stream) {
        return false;
      }
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
      overflowByWaveId.get(matchingWave.id)!.push(candidate);
      unassigned.push(candidate);
    }
  }

  return { assignedByWaveId, unassigned, overflowByWaveId };
}

/**
 * Legacy deterministic wave generator maintained for backward-compatibility.
 */
export function generateDeterministicWaveWindows(params: {
  specialization: string;
  dateStr: string;
  earliestTimeStr?: string;
  latestTimeStr?: string;
  windowMinutes: number;
  defaultCapacity: number;
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
