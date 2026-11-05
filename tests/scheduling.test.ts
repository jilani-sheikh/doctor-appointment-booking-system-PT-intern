import assert from "node:assert/strict";
import test from "node:test";
import {
  generateScheduleAvailabilities,
  validateScheduleInput,
  effectiveSlot,
  generatedScheduleDates,
  planScheduleDates,
  RECURRENCE_LABELS,
  SCHEDULE_TYPE_LABELS,
  shouldRestoreRecurringDate,
  scheduleDateRelationship,
  overrideRequiresConfirmation,
} from "@/lib/scheduling";
import { calculateQueueEstimates } from "@/lib/queue";

test("generates recurring Mondays and Wednesdays in IST date space", () => {
  const rows = generateScheduleAvailabilities(
    {
      type: "WAVE",
      recurrence: "RECURRING",
      startDate: "2026-11-05",
      endDate: "2026-12-05",
      daysOfWeek: [1, 3],
      startMinute: 600,
      endMinute: 720,
      durationMinutes: 30,
      capacity: 3,
    },
    "2026-11-01"
  );
  assert.equal(rows.filter((row) => row.kind === "WAVE_PARENT").length, 8);
  assert.equal(rows.filter((row) => row.kind === "WAVE_SLOT").length, 32);
});

test("generates one stream window per date", () => {
  const rows = generateScheduleAvailabilities(
    {
      type: "STREAM",
      recurrence: "ONCE",
      startDate: "2026-11-09",
      endDate: "2026-11-09",
      daysOfWeek: [],
      startMinute: 600,
      endMinute: 720,
      durationMinutes: 30,
      capacity: 2,
    },
    "2026-11-01"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, "STREAM_WINDOW");
});

test("generates all non-recurring Wave sub-slots for one date", () => {
  const rows = generateScheduleAvailabilities(
    {
      type: "WAVE",
      recurrence: "ONCE",
      startDate: "2026-11-07",
      endDate: "2026-11-07",
      daysOfWeek: [],
      startMinute: 600,
      endMinute: 720,
      durationMinutes: 30,
      capacity: 3,
    },
    "2026-11-01"
  );
  assert.equal(rows.filter((row) => row.kind === "WAVE_PARENT").length, 1);
  assert.equal(rows.filter((row) => row.kind === "WAVE_SLOT").length, 4);
});

test("recurring Stream schedules include every selected calendar date", () => {
  const rows = generateScheduleAvailabilities(
    {
      type: "STREAM",
      recurrence: "RECURRING",
      startDate: "2026-11-06",
      endDate: "2026-11-08",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startMinute: 600,
      endMinute: 720,
      durationMinutes: 15,
      capacity: 1,
    },
    "2026-11-01"
  );
  assert.deepEqual(rows.map((row) => row.date), ["2026-11-06", "2026-11-07", "2026-11-08"]);
});

test("validates Wave duration but keeps Stream capacity independent", () => {
  assert.equal(
    validateScheduleInput(
      {
        type: "WAVE",
        recurrence: "ONCE",
        startDate: "2026-11-09",
        endDate: "2026-11-09",
        daysOfWeek: [],
        startMinute: 600,
        endMinute: 710,
        durationMinutes: 30,
        capacity: 1,
      },
      "2026-11-01"
    ),
    "The schedule window must be divisible by the duration."
  );
  assert.equal(
    validateScheduleInput(
      {
        type: "STREAM",
        recurrence: "ONCE",
        startDate: "2026-11-09",
        endDate: "2026-11-09",
        daysOfWeek: [],
        startMinute: 600,
        endMinute: 660,
        durationMinutes: 30,
        capacity: 4,
      },
      "2026-11-01"
    ),
    null
  );
});

test("effective stream appointment range uses the complete window", () => {
  const appointment = {
    slotStart: null,
    slotEnd: null,
    availability: {
      startTime: new Date("2026-11-09T04:30:00.000Z"),
      endTime: new Date("2026-11-09T06:30:00.000Z"),
    },
  };
  const slot = effectiveSlot(appointment);
  assert.equal(slot.start.toISOString(), "2026-11-09T04:30:00.000Z");
  assert.equal(slot.end.toISOString(), "2026-11-09T06:30:00.000Z");
  const estimates = calculateQueueEstimates([
    {
      id: "stream-appointment",
      status: "CONFIRMED",
      scheduledStart: slot.start,
      scheduledEnd: slot.end,
      actualStartAt: null,
      actualEndAt: null,
      checkedInAt: null,
    },
  ], new Date("2026-11-09T05:00:00.000Z"));
  assert.equal(estimates.get("stream-appointment")?.scheduledStart.toISOString(), slot.start.toISOString());
});

test("labels use Wave and Non-recurring in the schedule generator", () => {
  assert.equal(SCHEDULE_TYPE_LABELS.WAVE, "Wave");
  assert.equal(SCHEDULE_TYPE_LABELS.STREAM, "Stream");
  assert.equal(RECURRENCE_LABELS.ONCE, "Non-recurring");
  assert.equal(RECURRENCE_LABELS.RECURRING, "Recurring");
});

test("non-recurring on a recurring date produces an override plan", () => {
  const input = {
    type: "WAVE" as const,
    recurrence: "ONCE" as const,
    startDate: "2026-11-09",
    endDate: "2026-11-09",
    daysOfWeek: [],
    startMinute: 600,
    endMinute: 720,
    durationMinutes: 30,
    capacity: 3,
  };
  const dates = generatedScheduleDates(input, "2026-11-01");
  const plans = planScheduleDates(input, dates, { "2026-11-09": ["recurring-1"] }, {});
  assert.deepEqual(plans, [{ date: "2026-11-09", overrideRecurringScheduleId: "recurring-1" }]);
});

test("recurring dates skip active non-recurring dates while other weekdays remain", () => {
  const input = {
    type: "STREAM" as const,
    recurrence: "RECURRING" as const,
    startDate: "2026-11-09",
    endDate: "2026-11-11",
    daysOfWeek: [1, 3],
    startMinute: 600,
    endMinute: 720,
    durationMinutes: 30,
    capacity: 2,
  };
  const dates = generatedScheduleDates(input, "2026-11-01");
  const plans = planScheduleDates(input, dates, {}, { "2026-11-09": ["once-1"] });
  assert.equal(plans.find((plan) => plan.date === "2026-11-09")?.skipForNonRecurringScheduleId, "once-1");
  assert.equal(plans.find((plan) => plan.date === "2026-11-11")?.skipForNonRecurringScheduleId, undefined);
});

test("overlap relationships distinguish conflicts, skips, and overrides", () => {
  const input = {
    type: "STREAM" as const,
    recurrence: "ONCE" as const,
    startDate: "2026-11-09",
    endDate: "2026-11-09",
    daysOfWeek: [],
    startMinute: 600,
    endMinute: 720,
    durationMinutes: 30,
    capacity: 2,
  };
  const dates = generatedScheduleDates(input, "2026-11-01");
  const plans = planScheduleDates(input, dates, {}, { "2026-11-09": ["once-1"] });
  assert.equal(plans[0]?.overrideRecurringScheduleId, undefined);
  assert.equal(scheduleDateRelationship("ONCE", "ONCE", true), "CONFLICT");
  assert.equal(scheduleDateRelationship("ONCE", "RECURRING", true), "OVERRIDE");
  assert.equal(scheduleDateRelationship("RECURRING", "ONCE", true), "SKIP");
  assert.equal(overrideRequiresConfirmation(1, false), true);
  assert.equal(overrideRequiresConfirmation(1, true), false);
  assert.equal(shouldRestoreRecurringDate(0, 0), true);
  assert.equal(shouldRestoreRecurringDate(1, 0), false);
  assert.equal(shouldRestoreRecurringDate(0, 1), false);
});
