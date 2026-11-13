import { APICallError, RetryError } from "ai";
import {
  AppointmentStatus,
  AvailabilityKind,
  RescheduleLifecycleStatus,
  SlotStatus,
} from "@/generated/prisma/enums";
import { DEFAULT_GEMINI_MODEL, getGeminiModelId } from "@/lib/env";
import { effectiveSlot } from "@/lib/scheduling";
import {
  formatDateIST,
  formatTimeIST,
  getISTDateString,
  getTodayISTDateString,
  parseISTDateTime,
} from "@/lib/time";
import { formatINR } from "@/lib/money";
import type { ConfirmActionType, StatsSummaryCard } from "@/lib/ai/schemas";

export function isActionAllowedForRole(
  action: ConfirmActionType,
  role: "PATIENT" | "DOCTOR"
): boolean {
  if (role === "PATIENT") {
    return action.startsWith("PATIENT_");
  }
  return action.startsWith("DOCTOR_");
}

/**
 * Formats a minute-of-day (0-1440) as "HH:mm".
 */
export function minutesToHHmm(minuteOfDay: number): string {
  const clamped = Math.max(0, Math.min(1440, minuteOfDay));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * Parses "HH:mm" into minutes since 00:00 IST. Returns null on invalid input.
 */
export function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 24 || mm < 0 || mm > 59 || (hh === 24 && mm > 0)) {
    return null;
  }
  return hh * 60 + mm;
}

/**
 * Formats an Availability slot start/end pair in IST as "h:mm AM – h:mm PM".
 */
export function formatSlotTimeRangeIST(startTime: Date, endTime: Date): string {
  return `${formatTimeIST(startTime)} – ${formatTimeIST(endTime)}`;
}

/**
 * Resolves relative date keywords ("today", "tomorrow") or YYYY-MM-DD in IST.
 */
export function resolveISTDateInput(dateInput?: string | null): string | null {
  if (!dateInput) return null;
  const trimmed = dateInput.trim().toLowerCase();
  const todayStr = getTodayISTDateString();

  if (trimmed === "today" || trimmed === "aaj") {
    return todayStr;
  }
  if (trimmed === "tomorrow" || trimmed === "kal") {
    const todayMidnight = parseISTDateTime(todayStr, "00:00");
    return getISTDateString(new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  return null;
}

export interface DoctorStatAppointmentLike {
  status: AppointmentStatus | string;
  disruptedAt: Date | null;
  rescheduleStatus: RescheduleLifecycleStatus | string | null;
}

export interface DoctorAppointmentStatsResult {
  total: number;
  confirmed: number;
  checkedIn: number;
  inConsultation: number;
  completed: number;
  cancelled: number;
  noShow: number;
  pendingPayment: number;
  disruptedPendingReschedule: number;
}

export function computeDoctorAppointmentStats(
  appointments: DoctorStatAppointmentLike[]
): DoctorAppointmentStatsResult {
  const stats: DoctorAppointmentStatsResult = {
    total: appointments.length,
    confirmed: 0,
    checkedIn: 0,
    inConsultation: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    pendingPayment: 0,
    disruptedPendingReschedule: 0,
  };

  for (const appt of appointments) {
    switch (appt.status) {
      case AppointmentStatus.CONFIRMED:
        stats.confirmed += 1;
        break;
      case AppointmentStatus.CHECKED_IN:
        stats.checkedIn += 1;
        break;
      case AppointmentStatus.IN_CONSULTATION:
        stats.inConsultation += 1;
        break;
      case AppointmentStatus.COMPLETED:
        stats.completed += 1;
        break;
      case AppointmentStatus.CANCELLED:
        stats.cancelled += 1;
        break;
      case AppointmentStatus.NO_SHOW:
        stats.noShow += 1;
        break;
      case AppointmentStatus.PENDING_PAYMENT:
        stats.pendingPayment += 1;
        break;
      default:
        break;
    }

    if (
      appt.disruptedAt !== null &&
      appt.rescheduleStatus === RescheduleLifecycleStatus.PENDING_RESCHEDULING
    ) {
      stats.disruptedPendingReschedule += 1;
    }
  }

  return stats;
}

export function buildDoctorStatsCard(
  title: string,
  dateRangeLabel: string,
  stats: DoctorAppointmentStatsResult
): StatsSummaryCard {
  return {
    type: "stats_summary",
    title,
    dateRangeLabel,
    metrics: [
      { label: "Total", value: stats.total },
      { label: "Confirmed", value: stats.confirmed, tone: "default" },
      { label: "Checked In", value: stats.checkedIn, tone: "warning" },
      { label: "In Consult", value: stats.inConsultation, tone: "warning" },
      { label: "Completed", value: stats.completed, tone: "success" },
      { label: "Cancelled", value: stats.cancelled, tone: "danger" },
      { label: "No Show", value: stats.noShow, tone: "danger" },
      {
        label: "Pending Reschedule",
        value: stats.disruptedPendingReschedule,
        tone: stats.disruptedPendingReschedule > 0 ? "danger" : "default",
      },
    ],
  };
}

export interface ConflictAppointmentInput {
  id: string;
  patientName: string;
  status: AppointmentStatus | string;
  slotStart: Date | null;
  slotEnd: Date | null;
  disruptedAt: Date | null;
  rescheduleStatus: RescheduleLifecycleStatus | string | null;
  availability: {
    id: string;
    startTime: Date;
    endTime: Date;
    status: SlotStatus | string;
    kind: AvailabilityKind | string;
    capacity: number;
    activeCount: number;
  };
}

export interface ConflictTimeOffInput {
  id: string;
  startAt: Date;
  endAt: Date;
  reason: string | null;
}

export interface DetectedConflictItem {
  severity: "high" | "medium";
  kind: string;
  dateIST: string;
  timeRangeIST: string;
  summary: string;
}

/**
 * Pure conflict detector for a doctor's active appointments against time-offs,
 * blocked slots, capacity overruns, and cross-slot overlaps.
 */
export function detectDoctorSchedulingConflicts(input: {
  appointments: ConflictAppointmentInput[];
  timeOffs: ConflictTimeOffInput[];
}): DetectedConflictItem[] {
  const conflicts: DetectedConflictItem[] = [];
  const active = input.appointments
    .filter(
      (appt) =>
        appt.status === AppointmentStatus.CONFIRMED ||
        appt.status === AppointmentStatus.CHECKED_IN ||
        appt.status === AppointmentStatus.IN_CONSULTATION ||
        appt.status === AppointmentStatus.PENDING_PAYMENT
    )
    .map((appt) => ({
      appt,
      window: effectiveSlot(appt),
    }))
    .sort((a, b) => a.window.start.getTime() - b.window.start.getTime());

  const checkedSlotOverflow = new Set<string>();
  for (const { appt, window } of active) {
    const dateIST = formatDateIST(window.start);
    const timeRangeIST = formatSlotTimeRangeIST(window.start, window.end);

    if (
      appt.disruptedAt &&
      appt.rescheduleStatus === RescheduleLifecycleStatus.PENDING_RESCHEDULING
    ) {
      conflicts.push({
        severity: "high",
        kind: "DISRUPTED_BOOKING",
        dateIST,
        timeRangeIST,
        summary: `${appt.patientName}'s appointment requires rescheduling after an availability change.`,
      });
    } else if (appt.availability.status === SlotStatus.BLOCKED) {
      conflicts.push({
        severity: "high",
        kind: "BOOKED_ON_BLOCKED_SLOT",
        dateIST,
        timeRangeIST,
        summary: `${appt.patientName} has an active booking on a blocked slot.`,
      });
    }

    if (
      appt.availability.activeCount > appt.availability.capacity &&
      !checkedSlotOverflow.has(appt.availability.id)
    ) {
      checkedSlotOverflow.add(appt.availability.id);
      conflicts.push({
        severity: "high",
        kind: "CAPACITY_OVERFLOW",
        dateIST,
        timeRangeIST,
        summary: `Slot active bookings (${appt.availability.activeCount}) exceed configured capacity (${appt.availability.capacity}).`,
      });
    }

    for (const leave of input.timeOffs) {
      if (window.start < leave.endAt && window.end > leave.startAt) {
        conflicts.push({
          severity: "high",
          kind: "TIME_OFF_COLLISION",
          dateIST,
          timeRangeIST,
          summary: `${appt.patientName}'s appointment overlaps scheduled time off${
            leave.reason ? ` (${leave.reason})` : ""
          }.`,
        });
      }
    }
  }

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (b.window.start >= a.window.end) {
        break;
      }
      if (a.appt.availability.id === b.appt.availability.id) {
        continue;
      }
      conflicts.push({
        severity: "medium",
        kind: "OVERLAPPING_APPOINTMENTS",
        dateIST: formatDateIST(a.window.start),
        timeRangeIST: `${formatSlotTimeRangeIST(a.window.start, a.window.end)} vs ${formatSlotTimeRangeIST(b.window.start, b.window.end)}`,
        summary: `Overlapping appointments across different slots: ${a.appt.patientName} and ${b.appt.patientName}.`,
      });
    }
  }

  return conflicts;
}

export function formatRupeesFromDecimal(value: unknown): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) {
    return "Free";
  }
  return formatINR(num);
}

export const GEMINI_FALLBACK_MODELS = [
  DEFAULT_GEMINI_MODEL,
  "gemini-3-flash-preview",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash-lite",
] as const;

const FALLBACK_STATUS_CODES = new Set([404, 408, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403]);

/**
 * Builds the deduplicated ordered list of Gemini model IDs to attempt.
 */
export function getGeminiModelCandidates(configuredModelId?: string): string[] {
  const rawList = [configuredModelId ?? getGeminiModelId(), ...GEMINI_FALLBACK_MODELS];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of rawList) {
    const trimmed = id.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      ordered.push(trimmed);
    }
  }
  return ordered;
}

/**
 * Extracts the underlying HTTP status code from AI SDK errors when present.
 */
export function extractGeminiStatusCode(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) {
    return error.statusCode;
  }
  if (RetryError.isInstance(error)) {
    return extractGeminiStatusCode(error.lastError);
  }
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    if (typeof code === "number") {
      return code;
    }
  }
  return undefined;
}

/**
 * Determines whether a failed Gemini request should fail over to the next candidate model.
 */
export function isFallbackEligibleGeminiError(error: unknown): boolean {
  const statusCode = extractGeminiStatusCode(error);
  if (typeof statusCode === "number") {
    if (NON_RETRYABLE_STATUS_CODES.has(statusCode)) {
      return false;
    }
    return FALLBACK_STATUS_CODES.has(statusCode);
  }
  if (RetryError.isInstance(error)) {
    return true;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return true;
    }
    const msg = error.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("aborted") ||
      msg.includes("fetch failed") ||
      msg.includes("econnreset") ||
      msg.includes("high demand")
    );
  }
  return false;
}

/** Returns 24-hour "HH:mm" time in IST (UTC+05:30), suitable for parseISTDateTime(). */
export function getISTHHmm(date: Date): string {
  const istMs = date.getTime() + (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(istMs);
  const hours = String(ist.getUTCHours()).padStart(2, "0");
  const minutes = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Derives a compact, readable session title from the first user prompt. */
export function buildChatSessionTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "New conversation";
  }
  if (normalized.length <= 72) {
    return normalized;
  }
  return `${normalized.slice(0, 69).trimEnd()}...`;
}

