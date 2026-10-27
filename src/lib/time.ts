/**
 * Time utility functions for Medrella.
 * All database timestamps are strictly stored in UTC.
 * Display formatting and time calculations standardize on Indian Standard Time (Asia/Kolkata, UTC+5:30).
 */

const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +5 hours 30 minutes in ms

/**
 * Formats a Date or timestamp as a localized date string in Asia/Kolkata.
 * Example: "28 Oct 2026"
 */
export function formatDateIST(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  }
): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    ...options,
  }).format(d);
}

/**
 * Formats a Date or timestamp as a localized time string in Asia/Kolkata.
 * Example: "10:00 AM"
 */
export function formatTimeIST(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }
): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    ...options,
  }).format(d);
}

/**
 * Formats a Date or timestamp as a full date-time string in Asia/Kolkata.
 * Example: "28 Oct 2026, 10:00 AM"
 */
export function formatDateTimeIST(date: Date | string | number): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return `${formatDateIST(d)}, ${formatTimeIST(d)}`;
}

/**
 * Creates a UTC Date instance representing the exact specified wall-clock time in IST (UTC+05:30).
 * India does not observe Daylight Saving Time, so the offset is always exactly +05:30.
 *
 * @param year e.g. 2026
 * @param month 1-indexed month (1 = Jan, 12 = Dec)
 * @param day 1-indexed day of month
 * @param hours 24-hour format (e.g. 10 for 10 AM, 16 for 4 PM)
 * @param minutes minutes (0-59)
 */
export function createISTDate(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): Date {
  // Compute UTC timestamp by subtracting 5 hours 30 minutes from the specified wall clock time
  const utcMillis = Date.UTC(year, month - 1, day, hours, minutes, 0, 0) - IST_OFFSET_MS;
  return new Date(utcMillis);
}

/**
 * Calculates tomorrow's date components in IST.
 */
export function getTomorrowIST(): { year: number; month: number; day: number; dayOfWeek: number } {
  // Current time + IST offset
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);

  // Add 1 day
  istNow.setUTCDate(istNow.getUTCDate() + 1);

  return {
    year: istNow.getUTCFullYear(),
    month: istNow.getUTCMonth() + 1, // 1-indexed
    day: istNow.getUTCDate(),
    dayOfWeek: istNow.getUTCDay(), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  };
}

/**
 * Returns today's date in YYYY-MM-DD format in IST timezone.
 */
export function getTodayISTDateString(): string {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const year = istNow.getUTCFullYear();
  const month = String(istNow.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istNow.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns a Date's date string in YYYY-MM-DD format in IST.
 */
export function getISTDateString(date: Date | string | number): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  const istDate = new Date(d.getTime() + IST_OFFSET_MS);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD date string and HH:mm 24-hr time string in IST into a UTC Date.
 */
export function parseISTDateTime(dateStr: string, timeStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const [hourStr, minStr] = timeStr.split(":");
  return createISTDate(
    parseInt(yearStr, 10),
    parseInt(monthStr, 10),
    parseInt(dayStr, 10),
    parseInt(hourStr, 10),
    parseInt(minStr, 10)
  );
}

/**
 * Formats a start and end time into an IST time range string.
 * Example: "10:00 AM - 10:30 AM"
 */
export function formatSlotTimeRangeIST(start: Date | string | number, end: Date | string | number): string {
  return `${formatTimeIST(start)} - ${formatTimeIST(end)}`;
}

