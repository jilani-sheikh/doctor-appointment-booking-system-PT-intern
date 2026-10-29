import test from "node:test";
import assert from "node:assert/strict";
import { VisitStream, WaveStatus, AppointmentStatus } from "../src/generated/prisma/client";
import {
  groupAppointmentsIntoWaves,
  generateDeterministicWaveWindows,
  calculateWaveMetrics,
  formatWaveArrivalWindowIST,
  type WaveAssignmentCandidate,
  type WaveTarget,
} from "../src/lib/waves";

test("generateDeterministicWaveWindows produces sequential draft windows", () => {
  const waves = generateDeterministicWaveWindows({
    specialization: "Cardiology",
    dateStr: "2026-10-29",
    earliestTimeStr: "09:00",
    latestTimeStr: "13:00",
    windowMinutes: 60,
    defaultCapacity: 3,
  });

  assert.equal(waves.length, 4);
  assert.equal(waves[0].specialization, "Cardiology");
  assert.equal(waves[0].capacity, 3);
  assert.equal(waves[0].status, WaveStatus.DRAFT);

  // Check sequential continuity
  for (let i = 0; i < waves.length - 1; i++) {
    assert.equal(waves[i].windowEnd.getTime(), waves[i + 1].windowStart.getTime());
  }
});

test("groupAppointmentsIntoWaves assigns within capacity and tracks overflow", () => {
  const w1Start = new Date("2026-10-29T09:00:00.000Z");
  const w1End = new Date("2026-10-29T10:00:00.000Z");

  const waves: WaveTarget[] = [
    {
      id: "wave-cardio-1",
      specialization: "Cardiology",
      windowStart: w1Start,
      windowEnd: w1End,
      capacity: 2, // Only holds 2
      status: WaveStatus.DRAFT,
    },
  ];

  const candidates: WaveAssignmentCandidate[] = [
    {
      id: "c1",
      patientId: "p1",
      patientName: "Alice",
      doctorId: "d1",
      doctorName: "Dr. Smith",
      specialization: "Cardiology",
      slotStartTime: new Date("2026-10-29T09:10:00.000Z"),
      slotEndTime: new Date("2026-10-29T09:30:00.000Z"),
      stream: VisitStream.NEW_CONSULTATION,
      status: AppointmentStatus.CONFIRMED,
    },
    {
      id: "c2",
      patientId: "p2",
      patientName: "Bob",
      doctorId: "d1",
      doctorName: "Dr. Smith",
      specialization: "Cardiology",
      slotStartTime: new Date("2026-10-29T09:20:00.000Z"),
      slotEndTime: new Date("2026-10-29T09:40:00.000Z"),
      stream: VisitStream.FOLLOW_UP,
      status: AppointmentStatus.CONFIRMED,
    },
    {
      id: "c3",
      patientId: "p3",
      patientName: "Charlie (Overflow)",
      doctorId: "d1",
      doctorName: "Dr. Smith",
      specialization: "Cardiology",
      slotStartTime: new Date("2026-10-29T09:40:00.000Z"),
      slotEndTime: new Date("2026-10-29T10:00:00.000Z"),
      stream: VisitStream.NEW_CONSULTATION,
      status: AppointmentStatus.CONFIRMED,
    },
    {
      id: "c4",
      patientId: "p4",
      patientName: "David (Different Spec)",
      doctorId: "d2",
      doctorName: "Dr. Bones",
      specialization: "Orthopedics",
      slotStartTime: new Date("2026-10-29T09:15:00.000Z"),
      slotEndTime: new Date("2026-10-29T09:45:00.000Z"),
      stream: VisitStream.NEW_CONSULTATION,
      status: AppointmentStatus.CONFIRMED,
    },
  ];

  const result = groupAppointmentsIntoWaves(candidates, waves);

  // wave-cardio-1 should have 2 candidates assigned
  const assigned = result.assignedByWaveId.get("wave-cardio-1")!;
  assert.equal(assigned.length, 2);
  assert.equal(assigned[0].id, "c1");
  assert.equal(assigned[1].id, "c2");

  // Overflow for wave-cardio-1 should have c3
  const overflow = result.overflowByWaveId.get("wave-cardio-1")!;
  assert.equal(overflow.length, 1);
  assert.equal(overflow[0].id, "c3");

  // Unassigned should contain c3 (overflow) and c4 (different specialization)
  assert.equal(result.unassigned.length, 2);
  const unassignedIds = result.unassigned.map((c) => c.id);
  assert.ok(unassignedIds.includes("c3"));
  assert.ok(unassignedIds.includes("c4"));
});

test("calculateWaveMetrics computes expected vs actual check-ins accurately", () => {
  const wStart = new Date("2026-10-29T09:00:00.000Z");
  const wEnd = new Date("2026-10-29T10:00:00.000Z");

  const wave: WaveTarget = {
    id: "wave-1",
    specialization: "Pediatrics",
    windowStart: wStart,
    windowEnd: wEnd,
    capacity: 5,
    status: WaveStatus.PUBLISHED,
  };

  const appointments = [
    // On-time check in (arrived within window)
    {
      status: AppointmentStatus.CHECKED_IN,
      checkedInAt: new Date("2026-10-29T09:15:00.000Z"),
    },
    // Late check in (arrived after windowEnd)
    {
      status: AppointmentStatus.CHECKED_IN,
      checkedInAt: new Date("2026-10-29T10:10:00.000Z"),
    },
    // No show
    {
      status: AppointmentStatus.NO_SHOW,
      checkedInAt: null,
    },
    // Not yet arrived
    {
      status: AppointmentStatus.CONFIRMED,
      checkedInAt: null,
    },
  ];

  const metrics = calculateWaveMetrics(wave, appointments);

  assert.equal(metrics.expectedArrivals, 4);
  assert.equal(metrics.actualCheckIns, 2); // 1 on-time + 1 late
  assert.equal(metrics.onTimeCheckIns, 1);
  assert.equal(metrics.lateCheckIns, 1);
  assert.equal(metrics.noShows, 1);
  assert.equal(metrics.notYetArrived, 1);
});

test("formatWaveArrivalWindowIST formats time range", () => {
  const start = new Date("2026-10-29T04:30:00.000Z"); // 10:00 AM IST
  const end = new Date("2026-10-29T05:30:00.000Z"); // 11:00 AM IST
  const str = formatWaveArrivalWindowIST(start, end);
  assert.ok(str.includes("IST"));
  assert.ok(str.includes("-"));
});
