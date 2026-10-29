import test from "node:test";
import assert from "node:assert/strict";
import { AppointmentStatus, Role } from "../src/generated/prisma/client";
import {
  isValidTransition,
  canPatientCheckIn,
  canDoctorNoShow,
  canPatientCancel,
  canPatientReschedule,
  isTerminalStatus,
  isActiveStatus,
} from "../src/lib/appointment-status";

test("isTerminalStatus and isActiveStatus identify correct sets", () => {
  assert.equal(isTerminalStatus(AppointmentStatus.COMPLETED), true);
  assert.equal(isTerminalStatus(AppointmentStatus.CANCELLED), true);
  assert.equal(isTerminalStatus(AppointmentStatus.NO_SHOW), true);
  assert.equal(isTerminalStatus(AppointmentStatus.CONFIRMED), false);
  assert.equal(isTerminalStatus(AppointmentStatus.CHECKED_IN), false);
  assert.equal(isTerminalStatus(AppointmentStatus.IN_CONSULTATION), false);

  assert.equal(isActiveStatus(AppointmentStatus.PENDING), true);
  assert.equal(isActiveStatus(AppointmentStatus.CONFIRMED), true);
  assert.equal(isActiveStatus(AppointmentStatus.CHECKED_IN), true);
  assert.equal(isActiveStatus(AppointmentStatus.IN_CONSULTATION), true);
  assert.equal(isActiveStatus(AppointmentStatus.COMPLETED), false);
});

test("isValidTransition: validates role and status transitions correctly", () => {
  // PENDING -> CONFIRMED (Admin legacy/migration only; Doctor cannot confirm)
  assert.equal(isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, Role.DOCTOR), false);
  assert.equal(isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, Role.ADMIN), true);
  assert.equal(isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, Role.PATIENT), false);

  // PENDING -> CANCELLED (any role)
  assert.equal(isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.CANCELLED, Role.PATIENT), true);
  assert.equal(isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.CANCELLED, Role.DOCTOR), true);

  // PENDING -> IN_CONSULTATION (illegal: must be CONFIRMED and CHECKED_IN first)
  assert.equal(isValidTransition(AppointmentStatus.PENDING, AppointmentStatus.IN_CONSULTATION, Role.DOCTOR), false);

  // CONFIRMED -> CHECKED_IN
  assert.equal(isValidTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, Role.PATIENT), true);
  assert.equal(isValidTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, Role.DOCTOR), true);

  // CONFIRMED -> NO_SHOW (Doctor/Admin only)
  assert.equal(isValidTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW, Role.DOCTOR), true);
  assert.equal(isValidTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW, Role.PATIENT), false);

  // CHECKED_IN -> IN_CONSULTATION (Doctor only)
  assert.equal(isValidTransition(AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION, Role.DOCTOR), true);
  assert.equal(isValidTransition(AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION, Role.PATIENT), false);
  assert.equal(isValidTransition(AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION, Role.ADMIN), false);

  // IN_CONSULTATION -> COMPLETED (Doctor only)
  assert.equal(isValidTransition(AppointmentStatus.IN_CONSULTATION, AppointmentStatus.COMPLETED, Role.DOCTOR), true);
  assert.equal(isValidTransition(AppointmentStatus.IN_CONSULTATION, AppointmentStatus.COMPLETED, Role.ADMIN), false);
  assert.equal(isValidTransition(AppointmentStatus.IN_CONSULTATION, AppointmentStatus.COMPLETED, Role.PATIENT), false);

  // Terminal status cannot transition anywhere
  assert.equal(isValidTransition(AppointmentStatus.COMPLETED, AppointmentStatus.CONFIRMED, Role.DOCTOR), false);
  assert.equal(isValidTransition(AppointmentStatus.CANCELLED, AppointmentStatus.PENDING, Role.DOCTOR), false);
  assert.equal(isValidTransition(AppointmentStatus.NO_SHOW, AppointmentStatus.CONFIRMED, Role.ADMIN), false);
});

test("canPatientCheckIn enforces 30m before start to end window", () => {
  const start = new Date("2026-10-29T10:00:00.000Z");
  const end = new Date("2026-10-29T10:30:00.000Z");
  const appt = { status: AppointmentStatus.CONFIRMED, startTime: start, endTime: end };

  // Too early (45 minutes before start)
  const tooEarly = new Date("2026-10-29T09:15:00.000Z");
  const res1 = canPatientCheckIn(appt, tooEarly);
  assert.equal(res1.allowed, false);
  assert.match(res1.reason || "", /Check-in opens 30 minutes before/);

  // Exactly at window opening (30 minutes before start)
  const exactlyOpen = new Date("2026-10-29T09:30:00.000Z");
  assert.equal(canPatientCheckIn(appt, exactlyOpen).allowed, true);

  // During consultation window
  const duringSlot = new Date("2026-10-29T10:15:00.000Z");
  assert.equal(canPatientCheckIn(appt, duringSlot).allowed, true);

  // Exactly at end
  assert.equal(canPatientCheckIn(appt, end).allowed, true);

  // Expired (1 minute after end)
  const expired = new Date("2026-10-29T10:31:00.000Z");
  const res2 = canPatientCheckIn(appt, expired);
  assert.equal(res2.allowed, false);
  assert.match(res2.reason || "", /expired/);

  // Non-confirmed status
  const pendingAppt = { status: AppointmentStatus.PENDING, startTime: start, endTime: end };
  assert.equal(canPatientCheckIn(pendingAppt, duringSlot).allowed, false);
});

test("canDoctorNoShow enforces 15m grace period past start", () => {
  const start = new Date("2026-10-29T10:00:00.000Z");
  const appt = { status: AppointmentStatus.CONFIRMED, startTime: start };

  // 10 minutes past start (still within 15m grace)
  const at10m = new Date("2026-10-29T10:10:00.000Z");
  const res1 = canDoctorNoShow(appt, at10m);
  assert.equal(res1.allowed, false);
  assert.match(res1.reason || "", /15 minutes after/);

  // 15 minutes past start
  const at15m = new Date("2026-10-29T10:15:00.000Z");
  assert.equal(canDoctorNoShow(appt, at15m).allowed, true);

  // 20 minutes past start
  const at20m = new Date("2026-10-29T10:20:00.000Z");
  assert.equal(canDoctorNoShow(appt, at20m).allowed, true);

  // Already completed cannot be marked no-show
  const compAppt = { status: AppointmentStatus.COMPLETED, startTime: start };
  assert.equal(canDoctorNoShow(compAppt, at20m).allowed, false);
});

test("canPatientCancel enforces 2h cutoff unless disrupted", () => {
  const start = new Date("2026-10-29T14:00:00.000Z");
  const now = new Date("2026-10-29T10:00:00.000Z"); // 4 hours before

  // > 2 hours before start -> Allowed
  const appt1 = { status: AppointmentStatus.CONFIRMED, startTime: start };
  assert.equal(canPatientCancel(appt1, now).allowed, true);

  // 1 hour before start -> Rejected
  const lateNow = new Date("2026-10-29T13:00:00.000Z");
  const res2 = canPatientCancel(appt1, lateNow);
  assert.equal(res2.allowed, false);
  assert.match(res2.reason || "", /at least 2 hours before/);

  // 1 hour before start, but disrupted by doctor absence -> Allowed!
  const disruptedAppt = {
    status: AppointmentStatus.CONFIRMED,
    startTime: start,
    disruptedAt: new Date("2026-10-29T12:00:00.000Z"),
  };
  assert.equal(canPatientCancel(disruptedAppt, lateNow).allowed, true);

  // Once checked in, patient cannot cancel
  const checkedInAppt = { status: AppointmentStatus.CHECKED_IN, startTime: start };
  assert.equal(canPatientCancel(checkedInAppt, now).allowed, false);
});

test("canPatientReschedule enforces max 2 reschedules and 2h cutoff", () => {
  const start = new Date("2026-10-29T16:00:00.000Z");
  const now = new Date("2026-10-29T10:00:00.000Z");

  // 0 reschedules, 6h before start -> Allowed
  assert.equal(
    canPatientReschedule({ status: AppointmentStatus.CONFIRMED, startTime: start, rescheduleCount: 0 }, now).allowed,
    true
  );

  // 1 reschedule, 6h before start -> Allowed
  assert.equal(
    canPatientReschedule({ status: AppointmentStatus.CONFIRMED, startTime: start, rescheduleCount: 1 }, now).allowed,
    true
  );

  // 2 reschedules (max reached) -> Rejected
  const maxed = canPatientReschedule(
    { status: AppointmentStatus.CONFIRMED, startTime: start, rescheduleCount: 2 },
    now
  );
  assert.equal(maxed.allowed, false);
  assert.match(maxed.reason || "", /Maximum of 2 reschedules reached/);

  // 1 hour before start without disruption -> Rejected
  const lateNow = new Date("2026-10-29T15:00:00.000Z");
  assert.equal(
    canPatientReschedule({ status: AppointmentStatus.CONFIRMED, startTime: start, rescheduleCount: 0 }, lateNow).allowed,
    false
  );

  // 1 hour before start with disruption -> Allowed
  assert.equal(
    canPatientReschedule(
      {
        status: AppointmentStatus.CONFIRMED,
        startTime: start,
        rescheduleCount: 0,
        disruptedAt: new Date("2026-10-29T14:30:00.000Z"),
      },
      lateNow
    ).allowed,
    true
  );
});
