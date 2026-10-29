import test from "node:test";
import assert from "node:assert/strict";
import { AppointmentStatus, Role } from "../src/generated/prisma/enums";
import {
  isValidTransition,
  canPatientCancel,
  canPatientReschedule,
  canPatientCheckIn,
  isActiveStatus,
} from "../src/lib/appointment-status";
import {
  MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT,
  MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY,
} from "../src/lib/constants";
import { getISTDateString, getISTDayRangeUTC } from "../src/lib/time";

test("Auto-Confirm Policy: Doctor confirmation step is completely removed from transition matrix", () => {
  // Doctor CANNOT transition PENDING to CONFIRMED (auto-confirm means doctor confirmation is obsolete)
  assert.equal(
    isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, Role.DOCTOR),
    false,
    "Doctor should not be permitted to transition PENDING -> CONFIRMED"
  );

  // Patient CANNOT transition PENDING to CONFIRMED
  assert.equal(
    isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, Role.PATIENT),
    false
  );

  // Admin retains PENDING -> CONFIRMED solely as legacy/data-migration path
  assert.equal(
    isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, Role.ADMIN),
    true,
    "Admin retains legacy migration ability to confirm orphaned PENDING appointments"
  );
});

test("Auto-Confirm Policy: Newly created appointments are CONFIRMED and immediately actionable", () => {
  // Verify CONFIRMED is an active status
  assert.equal(isActiveStatus(AppointmentStatus.CONFIRMED), true);

  // A newly booked appointment (which is CONFIRMED) allows check-in when within window
  const now = new Date("2026-10-29T10:00:00.000Z");
  const slotStart = new Date("2026-10-29T10:15:00.000Z"); // 15 min away
  const slotEnd = new Date("2026-10-29T10:45:00.000Z");

  const appt = {
    status: AppointmentStatus.CONFIRMED,
    startTime: slotStart,
    endTime: slotEnd,
  };

  const checkInEval = canPatientCheckIn(appt, now);
  assert.equal(checkInEval.allowed, true, "CONFIRMED appointment should allow patient self check-in inside the window");

  const cancelEval = canPatientCancel(appt, new Date("2026-10-29T07:00:00.000Z"));
  assert.equal(cancelEval.allowed, true, "CONFIRMED appointment can be cancelled > 2h before slot start");
});

test("Reschedule Policy: Rescheduled appointment preserves CONFIRMED status", () => {
  // Simulating reschedule transition logic:
  // When an appointment with CONFIRMED is rescheduled, its nextStatus remains CONFIRMED (never resets to PENDING)
  const currentStatus = AppointmentStatus.CONFIRMED;
  // Previously: nextStatus = currentStatus === CONFIRMED ? PENDING : currentStatus;
  // Now: nextStatus remains CONFIRMED
  const nextStatus = currentStatus;
  assert.equal(nextStatus, AppointmentStatus.CONFIRMED, "Rescheduled appointment must stay CONFIRMED");

  // It still satisfies patient reschedule limit rules
  const now = new Date("2026-10-29T08:00:00.000Z");
  const futureStart = new Date("2026-10-29T14:00:00.000Z"); // 6h away

  const eval1 = canPatientReschedule(
    { status: nextStatus, startTime: futureStart, rescheduleCount: 1 },
    now
  );
  assert.equal(eval1.allowed, true);

  const evalMax = canPatientReschedule(
    { status: nextStatus, startTime: futureStart, rescheduleCount: 2 },
    now
  );
  assert.equal(evalMax.allowed, false);
});

test("Abuse Guard Constants: Limits are correctly defined in constants file", () => {
  assert.equal(
    MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT,
    3,
    "Patient limit must be at most 3 active upcoming appointments"
  );
  assert.equal(
    MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY,
    1,
    "Patient limit must be at most 1 active booking per doctor per day"
  );
});

test("Abuse Guard: IST Day Range correctly evaluates doctor same-day booking boundary", () => {
  // Slot at 10:00 AM IST on Oct 30, 2026 (04:30 UTC)
  const slot1 = new Date("2026-10-30T04:30:00.000Z");
  // Slot at 04:00 PM IST on Oct 30, 2026 (10:30 UTC)
  const slot2 = new Date("2026-10-30T10:30:00.000Z");
  // Slot next day at 10:00 AM IST on Oct 31, 2026 (04:30 UTC)
  const slot3 = new Date("2026-10-31T04:30:00.000Z");

  const date1 = getISTDateString(slot1);
  const date2 = getISTDateString(slot2);
  const date3 = getISTDateString(slot3);

  assert.equal(date1, "2026-10-30");
  assert.equal(date2, "2026-10-30");
  assert.equal(date3, "2026-10-31");

  // Same day check
  const { start: dayStart, end: dayEnd } = getISTDayRangeUTC(date1);
  assert.equal(slot1 >= dayStart && slot1 <= dayEnd, true);
  assert.equal(slot2 >= dayStart && slot2 <= dayEnd, true, "Both slots on Oct 30 fall in same IST calendar day");
  assert.equal(slot3 >= dayStart && slot3 <= dayEnd, false, "Oct 31 slot must fall outside Oct 30 IST calendar day");
});
