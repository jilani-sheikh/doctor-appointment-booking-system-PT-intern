/**
 * Application-wide business rules and limits.
 */

/**
 * Maximum number of active upcoming appointments (CONFIRMED or CHECKED_IN with slot in the future)
 * that a patient can hold simultaneously.
 */
export const MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT = 3;

/**
 * Maximum number of active appointments a patient can hold with a single doctor on a single day (IST).
 */
export const MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY = 1;
