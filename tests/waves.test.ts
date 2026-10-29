import test from "node:test";
import assert from "node:assert/strict";
import { AppointmentStatus } from "@/generated/prisma/enums";
import {
  generateDoctorWaveSchedule,
  validateManualWaveOverlap,
  calculateWaveMetrics,
  formatWaveArrivalWindowIST,
  type WaveAssignmentCandidate,
} from "../src/lib/waves";
import { getISTDayRangeUTC, createISTDate, formatTimeIST } from "../src/lib/time";

// 1. Realistic Worked Example (Amendment 6)
test("Realistic 15-minute slots: 10:00, 10:15, 10:30 with window=30, capacity=2, buffer=15", () => {
  // Consultation slots at 10:00, 10:15, 10:30 IST on 2026-10-29
  const appt1: WaveAssignmentCandidate = {
    id: "a1",
    patientId: "p1",
    slotStartTime: createISTDate(2026, 10, 29, 10, 0),
    slotEndTime: createISTDate(2026, 10, 29, 10, 15),
    status: AppointmentStatus.CONFIRMED,
  };
  const appt2: WaveAssignmentCandidate = {
    id: "a2",
    patientId: "p2",
    slotStartTime: createISTDate(2026, 10, 29, 10, 15),
    slotEndTime: createISTDate(2026, 10, 29, 10, 30),
    status: AppointmentStatus.CONFIRMED,
  };
  const appt3: WaveAssignmentCandidate = {
    id: "a3",
    patientId: "p3",
    slotStartTime: createISTDate(2026, 10, 29, 10, 30),
    slotEndTime: createISTDate(2026, 10, 29, 10, 45),
    status: AppointmentStatus.CONFIRMED,
  };

  // Run wave generation with now before 09:45 IST
  const testNow = createISTDate(2026, 10, 29, 8, 0);

  const result = generateDoctorWaveSchedule({
    appointments: [appt1, appt2, appt3],
    windowMinutes: 30,
    capacity: 2,
    bufferMinutes: 15,
    now: testNow,
  });

  assert.equal(result.waves.length, 2, "Should create 2 waves");
  assert.equal(result.unassigned.length, 0, "All appointments should be assigned");

  // Wave 1: First slot is 10:00 -> arrival window 09:45 to 10:00
  const wave1 = result.waves[0];
  assert.equal(formatTimeIST(wave1.windowStart), "09:45 am");
  assert.equal(formatTimeIST(wave1.windowEnd), "10:00 am");
  assert.equal(wave1.appointments.length, 2);
  assert.deepEqual(
    wave1.appointments.map((a) => a.id),
    ["a1", "a2"]
  );

  // Wave 2: First slot is 10:30 -> arrival window 10:15 to 10:30
  const wave2 = result.waves[1];
  assert.equal(formatTimeIST(wave2.windowStart), "10:15 am");
  assert.equal(formatTimeIST(wave2.windowEnd), "10:30 am");
  assert.equal(wave2.appointments.length, 1);
  assert.deepEqual(
    wave2.appointments.map((a) => a.id),
    ["a3"]
  );

  // Invariant: Consultation slots are UNCHANGED
  assert.equal(formatTimeIST(wave1.appointments[0].slotStartTime), "10:00 am");
  assert.equal(formatTimeIST(wave1.appointments[1].slotStartTime), "10:15 am");
  assert.equal(formatTimeIST(wave2.appointments[0].slotStartTime), "10:30 am");
});

// 2. Capacity Split: 5 appointments in a chunk with capacity 2 -> 3 waves (2, 2, 1)
test("Capacity split: 5 appointments within windowMinutes=60 with capacity=2 produces 3 waves (2, 2, 1)", () => {
  const appts: WaveAssignmentCandidate[] = [
    { id: "1", patientId: "p1", slotStartTime: createISTDate(2026, 10, 29, 9, 0), slotEndTime: createISTDate(2026, 10, 29, 9, 10), status: AppointmentStatus.CONFIRMED },
    { id: "2", patientId: "p2", slotStartTime: createISTDate(2026, 10, 29, 9, 10), slotEndTime: createISTDate(2026, 10, 29, 9, 20), status: AppointmentStatus.CONFIRMED },
    { id: "3", patientId: "p3", slotStartTime: createISTDate(2026, 10, 29, 9, 20), slotEndTime: createISTDate(2026, 10, 29, 9, 30), status: AppointmentStatus.CONFIRMED },
    { id: "4", patientId: "p4", slotStartTime: createISTDate(2026, 10, 29, 9, 30), slotEndTime: createISTDate(2026, 10, 29, 9, 40), status: AppointmentStatus.CONFIRMED },
    { id: "5", patientId: "p5", slotStartTime: createISTDate(2026, 10, 29, 9, 40), slotEndTime: createISTDate(2026, 10, 29, 9, 50), status: AppointmentStatus.CONFIRMED },
  ];

  const result = generateDoctorWaveSchedule({
    appointments: appts,
    windowMinutes: 60,
    capacity: 2,
    bufferMinutes: 15,
    now: createISTDate(2026, 10, 29, 7, 0),
  });

  assert.equal(result.waves.length, 3);
  assert.equal(result.waves[0].appointments.length, 2);
  assert.equal(result.waves[1].appointments.length, 2);
  assert.equal(result.waves[2].appointments.length, 1);
});

// 3. Checked-In Past Window vs Expired Confirmed (Amendment 3)
test("Already CHECKED_IN patients whose window has passed are NOT unassigned, but CONFIRMED patients are marked expired", () => {
  // Slot at 09:00 IST -> arrival window: 08:45 to 09:00 IST
  const slotStart = createISTDate(2026, 10, 29, 9, 0);
  const slotEnd = createISTDate(2026, 10, 29, 9, 15);

  const checkedInPatient: WaveAssignmentCandidate = {
    id: "appt-checked-in",
    patientId: "p1",
    slotStartTime: slotStart,
    slotEndTime: slotEnd,
    status: AppointmentStatus.CHECKED_IN,
    checkedInAt: createISTDate(2026, 10, 29, 8, 50),
  };

  const confirmedPatient: WaveAssignmentCandidate = {
    id: "appt-confirmed",
    patientId: "p2",
    slotStartTime: slotStart,
    slotEndTime: slotEnd,
    status: AppointmentStatus.CONFIRMED,
  };

  // 'now' is 09:10 IST (past the arrival window end of 09:00 IST)
  const now = createISTDate(2026, 10, 29, 9, 10);

  const result = generateDoctorWaveSchedule({
    appointments: [checkedInPatient, confirmedPatient],
    windowMinutes: 30,
    capacity: 2,
    bufferMinutes: 15,
    now,
  });

  // Checked-in patient is kept in the wave
  assert.equal(result.waves.length, 1, "Wave should exist with the checked-in patient");
  assert.equal(result.waves[0].appointments.length, 1);
  assert.equal(result.waves[0].appointments[0].id, "appt-checked-in");

  // Confirmed patient is unassigned with specific reason "Arrival window expired"
  assert.equal(result.unassigned.length, 1);
  assert.equal(result.unassigned[0].appointment.id, "appt-confirmed");
  assert.equal(result.unassigned[0].reason, "Arrival window expired");
});

// 4. Past-Window Clamp: Clamps arrivalStart to now if arrivalStart < now
test("Past-window clamp: arrival window start is clamped to now when in the past", () => {
  // First slot is at 10:00 IST. With 30 min buffer, arrival start would be 09:30 IST.
  const slotStart = createISTDate(2026, 10, 29, 10, 0);
  const slotEnd = createISTDate(2026, 10, 29, 10, 15);

  // 'now' is 09:40 IST (between 09:30 and 10:00)
  const now = createISTDate(2026, 10, 29, 9, 40);

  const result = generateDoctorWaveSchedule({
    appointments: [
      {
        id: "a1",
        patientId: "p1",
        slotStartTime: slotStart,
        slotEndTime: slotEnd,
        status: AppointmentStatus.CONFIRMED,
      },
    ],
    windowMinutes: 30,
    capacity: 2,
    bufferMinutes: 30,
    now,
  });

  assert.equal(result.waves.length, 1);
  // Window start clamped to now (09:40 IST) instead of 09:30 IST
  assert.equal(result.waves[0].windowStart.getTime(), now.getTime());
  assert.equal(formatTimeIST(result.waves[0].windowStart), "09:40 am");
  assert.equal(formatTimeIST(result.waves[0].windowEnd), "10:00 am");
});

// 5. Overlap Validation: MANUAL waves only vs Generated waves (Amendment 1)
test("Manual wave overlap validation rejects overlapping manual waves and permits non-overlapping", () => {
  const existing = [
    {
      id: "w1",
      windowStart: createISTDate(2026, 10, 29, 9, 0),
      windowEnd: createISTDate(2026, 10, 29, 10, 0),
    },
  ];

  // Overlapping: 09:30 to 10:30 overlaps w1
  const overlapRes = validateManualWaveOverlap(
    {
      windowStart: createISTDate(2026, 10, 29, 9, 30),
      windowEnd: createISTDate(2026, 10, 29, 10, 30),
    },
    existing
  );
  assert.equal(overlapRes.valid, false);
  assert.ok(overlapRes.error?.includes("overlaps"));

  // Non-overlapping: 10:00 to 11:00 touches boundary but does not overlap [9:00, 10:00)
  const nonOverlapRes = validateManualWaveOverlap(
    {
      windowStart: createISTDate(2026, 10, 29, 10, 0),
      windowEnd: createISTDate(2026, 10, 29, 11, 0),
    },
    existing
  );
  assert.equal(nonOverlapRes.valid, true);
});

test("Generated waves may legitimately overlap when arrival buffer exceeds gap between groups (Amendment 1)", () => {
  // Wave 1 first slot @ 10:00. Buffer = 30m -> arrival 09:30 to 10:00
  // Wave 2 first slot @ 10:15. Buffer = 30m -> arrival 09:45 to 10:15
  // Arrival windows [09:30, 10:00] and [09:45, 10:15] overlap between 09:45 and 10:00.
  const appt1: WaveAssignmentCandidate = {
    id: "a1",
    patientId: "p1",
    slotStartTime: createISTDate(2026, 10, 29, 10, 0),
    slotEndTime: createISTDate(2026, 10, 29, 10, 15),
    status: AppointmentStatus.CONFIRMED,
  };
  const appt2: WaveAssignmentCandidate = {
    id: "a2",
    patientId: "p2",
    slotStartTime: createISTDate(2026, 10, 29, 10, 15),
    slotEndTime: createISTDate(2026, 10, 29, 10, 30),
    status: AppointmentStatus.CONFIRMED,
  };

  const result = generateDoctorWaveSchedule({
    appointments: [appt1, appt2],
    windowMinutes: 10, // each gets its own chunk
    capacity: 1,
    bufferMinutes: 30, // 30m buffer -> overlapping arrival windows
    now: createISTDate(2026, 10, 29, 8, 0),
  });

  assert.equal(result.waves.length, 2);
  assert.equal(formatTimeIST(result.waves[0].windowStart), "09:30 am");
  assert.equal(formatTimeIST(result.waves[0].windowEnd), "10:00 am");
  assert.equal(formatTimeIST(result.waves[1].windowStart), "09:45 am");
  assert.equal(formatTimeIST(result.waves[1].windowEnd), "10:15 am");
  // Legitimate overlap is preserved and not altered
  assert.ok(result.waves[1].windowStart.getTime() < result.waves[0].windowEnd.getTime());
});

// 6. IST Date Boundaries: 23:30 IST vs 00:15 IST (Amendment 5)
test("IST date boundaries test: 23:30 IST vs 00:15 IST segregated correctly into respective IST days", () => {
  // Appointment A: 2026-10-28 at 23:30 IST
  // In UTC: 2026-10-28 at 18:00:00.000Z
  const apptA = createISTDate(2026, 10, 28, 23, 30);

  // Appointment B: 2026-10-29 at 00:15 IST
  // In UTC: 2026-10-28 at 18:45:00.000Z (Notice: both are on UTC Oct 28!)
  const apptB = createISTDate(2026, 10, 29, 0, 15);

  const oct28Range = getISTDayRangeUTC("2026-10-28");
  const oct29Range = getISTDayRangeUTC("2026-10-29");

  // Verify Appt A (23:30 IST on Oct 28)
  assert.ok(apptA.getTime() >= oct28Range.start.getTime(), "Appt A should be >= Oct 28 start");
  assert.ok(apptA.getTime() <= oct28Range.end.getTime(), "Appt A should be <= Oct 28 end");
  assert.ok(apptA.getTime() < oct29Range.start.getTime(), "Appt A should be before Oct 29 start");

  // Verify Appt B (00:15 IST on Oct 29)
  assert.ok(apptB.getTime() >= oct29Range.start.getTime(), "Appt B should be >= Oct 29 start");
  assert.ok(apptB.getTime() <= oct29Range.end.getTime(), "Appt B should be <= Oct 29 end");
  assert.ok(apptB.getTime() > oct28Range.end.getTime(), "Appt B should be after Oct 28 end");
});

// 7. Empty day & Single appointment
test("Empty day returns empty waves and unassigned", () => {
  const result = generateDoctorWaveSchedule({
    appointments: [],
    windowMinutes: 30,
    capacity: 3,
    bufferMinutes: 15,
  });
  assert.deepEqual(result.waves, []);
  assert.deepEqual(result.unassigned, []);
});

test("Single appointment produces exactly one wave", () => {
  const appt: WaveAssignmentCandidate = {
    id: "single-1",
    patientId: "p1",
    slotStartTime: createISTDate(2026, 10, 29, 14, 0),
    slotEndTime: createISTDate(2026, 10, 29, 14, 15),
    status: AppointmentStatus.CONFIRMED,
  };

  const result = generateDoctorWaveSchedule({
    appointments: [appt],
    windowMinutes: 30,
    capacity: 3,
    bufferMinutes: 15,
    now: createISTDate(2026, 10, 29, 12, 0),
  });

  assert.equal(result.waves.length, 1);
  assert.equal(result.waves[0].appointments.length, 1);
  assert.equal(formatTimeIST(result.waves[0].windowStart), "01:45 pm");
  assert.equal(formatTimeIST(result.waves[0].windowEnd), "02:00 pm");
});

test("calculateWaveMetrics and formatWaveArrivalWindowIST compute and format correctly", () => {
  const windowEnd = createISTDate(2026, 10, 29, 10, 0);
  const metrics = calculateWaveMetrics(
    { windowEnd },
    [
      { status: AppointmentStatus.CHECKED_IN, checkedInAt: createISTDate(2026, 10, 29, 9, 50) },
      { status: AppointmentStatus.CHECKED_IN, checkedInAt: createISTDate(2026, 10, 29, 10, 10) },
      { status: AppointmentStatus.NO_SHOW, checkedInAt: null },
      { status: AppointmentStatus.CONFIRMED, checkedInAt: null },
    ]
  );
  assert.equal(metrics.expectedArrivals, 4);
  assert.equal(metrics.actualCheckIns, 2);
  assert.equal(metrics.onTimeCheckIns, 1);
  assert.equal(metrics.lateCheckIns, 1);
  assert.equal(metrics.noShows, 1);
  assert.equal(metrics.notYetArrived, 1);

  const formatted = formatWaveArrivalWindowIST(createISTDate(2026, 10, 29, 9, 30), windowEnd);
  assert.ok(formatted.includes("IST"));
  assert.ok(formatted.includes("am"));
});

