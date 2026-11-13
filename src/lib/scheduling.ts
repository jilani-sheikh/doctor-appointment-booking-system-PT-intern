import { parseISTDateTime } from "@/lib/time";

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
