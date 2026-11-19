import { AppointmentStatus, AvailabilityKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { formatSlotTimeRangeIST, formatTimeIST, getISTDateString } from "@/lib/time";

export interface QueueScopeInput {
  doctorId: string;
  startTime: Date | string | number;
  availabilityId: string;
}

/**
 * Deterministic sub-slot queue identity separating Doctor ID, clinic IST date,
 * and exact slot/sub-slot (SINGLE, WAVE_SLOT, or STREAM_WINDOW).
 */
export function buildSubSlotQueueScopeKey(input: QueueScopeInput): string {
  const dateIST = getISTDateString(new Date(input.startTime));
  return `${input.doctorId}:${dateIST}:${input.availabilityId}`;
}

export interface SubSlotLabelInput {
  kind?: AvailabilityKind | string | null;
  availabilityStart: Date | string | number;
  availabilityEnd: Date | string | number;
  slotStart?: Date | string | number | null;
  slotEnd?: Date | string | number | null;
}

/**
 * Human-readable IST label for the appointment's specific sub-slot or stream window.
 */
export function formatSubSlotLabel(input: SubSlotLabelInput): string {
  const start = new Date(input.slotStart ?? input.availabilityStart);
  const end = new Date(input.slotEnd ?? input.availabilityEnd);
  const range = formatSlotTimeRangeIST(start, end);

  if (input.kind === AvailabilityKind.WAVE_SLOT) {
    return `Wave Sub-slot ${range} IST`;
  }
  if (input.kind === AvailabilityKind.STREAM_WINDOW) {
    return `Stream Window ${range} IST`;
  }
  return `Slot ${range} IST`;
}

/**
 * Compact sub-slot window string without the type prefix.
 */
export function formatSubSlotTimeLabel(input: {
  startTime: Date | string | number;
  endTime: Date | string | number;
}): string {
  return `${formatTimeIST(new Date(input.startTime))} – ${formatTimeIST(new Date(input.endTime))} IST`;
}

/**
 * Maps internal AppointmentStatus values to clear portal queue labels.
 */
export function getQueueStatusLabel(status: AppointmentStatus): string {
  switch (status) {
    case AppointmentStatus.CONFIRMED:
      return "Waiting";
    case AppointmentStatus.CHECKED_IN:
      return "Checked In";
    case AppointmentStatus.CALLED:
      return "Called";
    case AppointmentStatus.IN_CONSULTATION:
      return "In Consultation";
    case AppointmentStatus.COMPLETED:
      return "Completed";
    case AppointmentStatus.NO_SHOW:
      return "Not Arrived";
    case AppointmentStatus.CANCELLED:
      return "Cancelled";
    case AppointmentStatus.PENDING_PAYMENT:
      return "Payment Pending";
    case AppointmentStatus.PENDING:
    default:
      return "Pending";
  }
}

export interface CallableQueueCandidate {
  id: string;
  status: AppointmentStatus;
  tokenNumber?: number | null;
  checkedInAt?: Date | string | null;
  createdAt?: Date | string | null;
}

function toMs(value: Date | string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? fallback : ms;
}

/**
 * Sorts appointments inside a single sub-slot queue deterministically:
 * - Primary: persisted tokenNumber ascending (nulls last)
 * - Secondary: checkedInAt ascending, then createdAt ascending, then id
 */
export function compareSubSlotTokenOrder<
  T extends {
    id: string;
    tokenNumber?: number | null;
    checkedInAt?: Date | string | null;
    createdAt?: Date | string | null;
  },
>(a: T, b: T): number {
  const tokenA = a.tokenNumber ?? Number.MAX_SAFE_INTEGER;
  const tokenB = b.tokenNumber ?? Number.MAX_SAFE_INTEGER;
  if (tokenA !== tokenB) return tokenA - tokenB;

  const checkedA = toMs(a.checkedInAt, Number.MAX_SAFE_INTEGER);
  const checkedB = toMs(b.checkedInAt, Number.MAX_SAFE_INTEGER);
  if (checkedA !== checkedB) return checkedA - checkedB;

  const createdA = toMs(a.createdAt, Number.MAX_SAFE_INTEGER);
  const createdB = toMs(b.createdAt, Number.MAX_SAFE_INTEGER);
  if (createdA !== createdB) return createdA - createdB;

  return a.id.localeCompare(b.id);
}

/**
 * Identifies the next eligible CHECKED_IN patient inside a doctor's sub-slot queue.
 */
export function pickNextCallableAppointment<T extends CallableQueueCandidate>(
  appointments: readonly T[]
): T | null {
  const eligible = appointments.filter(
    (appt) => appt.status === AppointmentStatus.CHECKED_IN
  );
  if (eligible.length === 0) return null;

  eligible.sort(compareSubSlotTokenOrder);
  return eligible[0] ?? null;
}

export interface TokenTransactionClient {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
}

export interface AllocatedSubSlotToken {
  tokenNumber: number;
  queueScopeKey: string;
}

/**
 * Atomically increments the monotonic per-availability token counter in Postgres
 * and derives the sub-slot queueScopeKey + next sequential tokenNumber (#1, #2, ...).
 * Must execute inside a database transaction (`db.$transaction`).
 *
 * Row-level locking on `"availabilities"` guarantees:
 * - Parallel bookings on the same sub-slot serialize cleanly with zero duplicate tokens.
 * - Cancelled, no-show, completed, or rescheduled tokens are never reissued.
 */
export async function allocateSubSlotToken(
  tx: TokenTransactionClient,
  availabilityId: string
): Promise<AllocatedSubSlotToken> {
  const rows = await tx.$queryRaw<
    Array<{ token_counter: number; doctor_id: string; start_time: Date }>
  >`
    UPDATE "availabilities"
    SET "token_counter" = "token_counter" + 1
    WHERE "id" = ${availabilityId}
    RETURNING "token_counter", "doctor_id", "start_time"
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("SLOT_UNAVAILABLE");
  }

  const tokenNumber = Number(row.token_counter);
  const queueScopeKey = buildSubSlotQueueScopeKey({
    doctorId: row.doctor_id,
    startTime: row.start_time,
    availabilityId,
  });

  return { tokenNumber, queueScopeKey };
}

export function formatDoctorDisplayName(name: string | null | undefined): string {
  const cleaned = (name ?? "Practitioner").trim();
  if (!cleaned) return "Dr. Practitioner";
  return /^dr\.?\s/i.test(cleaned) ? cleaned : `Dr. ${cleaned}`;
}

/**
 * Formats the attending doctor notification text when Reception Desk calls the next patient
 * for a selected doctor and sub-slot.
 */
export function formatDoctorCalledNotification(input: {
  doctorName: string | null | undefined;
  patientName: string | null | undefined;
  tokenNumber?: number | null;
  subSlotLabel: string;
  calledAt: Date;
}): { title: string; body: string } {
  const doctorLabel = formatDoctorDisplayName(input.doctorName);
  const patientLabel = (input.patientName ?? "Patient").trim() || "Patient";
  const tokenLabel =
    typeof input.tokenNumber === "number" && input.tokenNumber > 0
      ? `Token #${input.tokenNumber}`
      : "Token Pending";
  const timeLabel = formatTimeIST(input.calledAt);

  return {
    title: "Next Patient Called by Reception",
    body: `Reception Desk called Patient ${patientLabel} – ${tokenLabel} for ${doctorLabel} (${input.subSlotLabel}, ${timeLabel} IST).`,
  };
}

