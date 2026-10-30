/**
 * Application-wide business rules and limits.
 */

/**
 * Maximum number of active upcoming appointments (CONFIRMED, CHECKED_IN, or PENDING_PAYMENT hold with slot in the future)
 * that a patient can hold simultaneously.
 */
export const MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT = 3;

/**
 * Maximum number of active appointments a patient can hold with a single doctor on a single day (IST).
 */
export const MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY = 1;

/**
 * Maximum number of simultaneous active checkout holds (PENDING_PAYMENT) per patient.
 * Prevents slot hoarding during checkout.
 */
export const MAX_SIMULTANEOUS_HOLDS_PER_PATIENT = 2;

/**
 * Hold duration in minutes for an unconfirmed appointment pending online payment.
 * Must be >= Cashfree minimum order expiry (5 minutes). Default: 15 minutes.
 */
export const HOLD_MINUTES = 15;

/**
 * Cashfree default API version string.
 * Must match the webhook payload version selected in the Cashfree dashboard.
 */
export const DEFAULT_CASHFREE_API_VERSION = "2023-08-01";

/**
 * Maximum allowed drift between server time and webhook timestamp in seconds.
 * 300 seconds = 5 minutes.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Default reminder notification offsets in minutes prior to appointment slot startTime.
 * 1440 minutes = 24 hours, 120 minutes = 2 hours.
 */
export const DEFAULT_REMINDER_OFFSETS_MINUTES = [1440, 120];
