import test from "node:test";
import assert from "node:assert/strict";
import { AppointmentStatus } from "../src/generated/prisma/client";
import {
  calculateQueueEstimates,
  calculateQueueSummary,
  roundToNearest5Minutes,
  type QueueAppointmentItem,
} from "../src/lib/queue";

test("roundToNearest5Minutes rounds correctly", () => {
  assert.equal(roundToNearest5Minutes(0), 0);
  assert.equal(roundToNearest5Minutes(-5), 0);
  assert.equal(roundToNearest5Minutes(2), 0);
  assert.equal(roundToNearest5Minutes(3), 5);
  assert.equal(roundToNearest5Minutes(7), 5);
  assert.equal(roundToNearest5Minutes(8), 10);
  assert.equal(roundToNearest5Minutes(14), 15);
  assert.equal(roundToNearest5Minutes(22), 20);
  assert.equal(roundToNearest5Minutes(23), 25);
});

test("calculateQueueEstimates: empty appointments list returns empty map", () => {
  const result = calculateQueueEstimates([], new Date());
  assert.equal(result.size, 0);
});

test("calculateQueueEstimates: terminal statuses (CANCELLED, NO_SHOW, COMPLETED) are filtered out", () => {
  const base = new Date("2026-10-29T10:00:00.000Z");
  const items: QueueAppointmentItem[] = [
    {
      id: "a1",
      status: AppointmentStatus.COMPLETED,
      scheduledStart: base,
      scheduledEnd: new Date(base.getTime() + 30 * 60 * 1000),
    },
    {
      id: "a2",
      status: AppointmentStatus.CANCELLED,
      scheduledStart: new Date(base.getTime() + 30 * 60 * 1000),
      scheduledEnd: new Date(base.getTime() + 60 * 60 * 1000),
    },
    {
      id: "a3",
      status: AppointmentStatus.NO_SHOW,
      scheduledStart: new Date(base.getTime() + 60 * 60 * 1000),
      scheduledEnd: new Date(base.getTime() + 90 * 60 * 1000),
    },
  ];

  const result = calculateQueueEstimates(items, base);
  assert.equal(result.size, 0);
});

test("calculateQueueEstimates: delay propagation and variable slot duration (endTime - startTime)", () => {
  const t10_00 = new Date("2026-10-29T10:00:00.000Z");
  const t10_20 = new Date("2026-10-29T10:20:00.000Z"); // 20m slot
  const t10_40 = new Date("2026-10-29T10:40:00.000Z"); // 20m slot
  const t11_10 = new Date("2026-10-29T11:10:00.000Z"); // 30m slot

  // First appointment is IN_CONSULTATION from 10:00, but now is 10:30 (overrun by 10m)
  const now = new Date("2026-10-29T10:30:00.000Z");

  const items: QueueAppointmentItem[] = [
    {
      id: "in_prog",
      status: AppointmentStatus.IN_CONSULTATION,
      scheduledStart: t10_00,
      scheduledEnd: t10_20,
      actualStartAt: t10_00,
    },
    {
      id: "next_waiting",
      status: AppointmentStatus.CHECKED_IN,
      scheduledStart: t10_20,
      scheduledEnd: t10_40,
    },
    {
      id: "third_confirmed",
      status: AppointmentStatus.CONFIRMED,
      scheduledStart: t10_40,
      scheduledEnd: t11_10, // 30 min duration
    },
  ];

  const result = calculateQueueEstimates(items, now);
  assert.equal(result.size, 3);

  // 1. in_prog: expectedEnd should be max(now = 10:30, 10:00 + 20m = 10:20) => 10:30
  const est1 = result.get("in_prog")!;
  assert.ok(est1.isCurrent);
  assert.equal(est1.queuePosition, 1);
  assert.equal(est1.expectedEnd.getTime(), now.getTime());
  assert.equal(est1.delayMinutes, 10);
  assert.equal(est1.roundedDelayMinutes, 10);

  // 2. next_waiting: scheduled 10:20. Since in_prog finishes at 10:30, expectedStart = 10:30
  // slotDuration is 20m, so expectedEnd = 10:50. Delay = 10:30 - 10:20 = 10 minutes.
  const est2 = result.get("next_waiting")!;
  assert.ok(!est2.isCurrent);
  assert.equal(est2.queuePosition, 2);
  assert.equal(est2.expectedStart.toISOString(), "2026-10-29T10:30:00.000Z");
  assert.equal(est2.expectedEnd.toISOString(), "2026-10-29T10:50:00.000Z");
  assert.equal(est2.delayMinutes, 10);
  assert.equal(est2.roundedDelayMinutes, 10);

  // 3. third_confirmed: scheduled 10:40. Since previous finishes at 10:50, expectedStart = 10:50
  // slotDuration is 30m (t11_10 - t10_40), so expectedEnd = 11:20.
  // Delay = 10:50 - 10:40 = 10 minutes.
  const est3 = result.get("third_confirmed")!;
  assert.ok(!est3.isCurrent);
  assert.equal(est3.queuePosition, 3);
  assert.equal(est3.expectedStart.toISOString(), "2026-10-29T10:50:00.000Z");
  assert.equal(est3.expectedEnd.toISOString(), "2026-10-29T11:20:00.000Z");
  assert.equal(est3.delayMinutes, 10);
});

test("calculateQueueEstimates: past slot with nothing in progress preserves scheduled end", () => {
  // Rule 5: If previous slot is past and nothing is in progress, previous expectedEnd is its scheduled end, not now.
  const t09_00 = new Date("2026-10-29T09:00:00.000Z");
  const t09_30 = new Date("2026-10-29T09:30:00.000Z");
  const t10_00 = new Date("2026-10-29T10:00:00.000Z");
  const t10_30 = new Date("2026-10-29T10:30:00.000Z");

  // It is now 09:45, but doctor hasn't started 09:00 yet (still CONFIRMED)
  const now = new Date("2026-10-29T09:45:00.000Z");

  const items: QueueAppointmentItem[] = [
    {
      id: "a1",
      status: AppointmentStatus.CONFIRMED,
      scheduledStart: t09_00,
      scheduledEnd: t09_30,
    },
    {
      id: "a2",
      status: AppointmentStatus.CONFIRMED,
      scheduledStart: t10_00,
      scheduledEnd: t10_30,
    },
  ];

  const result = calculateQueueEstimates(items, now);
  const est1 = result.get("a1")!;
  assert.equal(est1.expectedStart.toISOString(), t09_00.toISOString());
  assert.equal(est1.expectedEnd.toISOString(), t09_30.toISOString());

  // a2 is at 10:00, which is > 09:30, so its expectedStart is scheduledStart (10:00), no delay
  const est2 = result.get("a2")!;
  assert.equal(est2.expectedStart.toISOString(), t10_00.toISOString());
  assert.equal(est2.delayMinutes, 0);
});

test("calculateQueueSummary computes correct totals", () => {
  const base = new Date("2026-10-29T10:00:00.000Z");
  const items: QueueAppointmentItem[] = [
    { id: "1", status: AppointmentStatus.CHECKED_IN, scheduledStart: base, scheduledEnd: new Date(base.getTime() + 15 * 60000) },
    { id: "2", status: AppointmentStatus.IN_CONSULTATION, scheduledStart: base, scheduledEnd: new Date(base.getTime() + 15 * 60000) },
    { id: "3", status: AppointmentStatus.COMPLETED, scheduledStart: base, scheduledEnd: new Date(base.getTime() + 15 * 60000) },
    { id: "4", status: AppointmentStatus.CONFIRMED, scheduledStart: base, scheduledEnd: new Date(base.getTime() + 15 * 60000) },
    { id: "5", status: AppointmentStatus.CANCELLED, scheduledStart: base, scheduledEnd: new Date(base.getTime() + 15 * 60000) },
  ];

  const estimates = calculateQueueEstimates(items, base);
  const summary = calculateQueueSummary(items, estimates);

  assert.equal(summary.waiting, 1);
  assert.equal(summary.inProgress, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.remaining, 3); // CHECKED_IN + IN_CONSULTATION + CONFIRMED
});
