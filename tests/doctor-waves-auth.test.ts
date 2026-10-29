import test from "node:test";
import assert from "node:assert/strict";
import {
  doctorWaveSettingsSchema,
  createDoctorManualWaveSchema,
  generateDoctorWavesSchema,
  publishDoctorWaveSchema,
  reassignDoctorWaveAppointmentSchema,
  deleteDoctorDraftWaveSchema,
} from "../src/lib/validations/waves";

test("doctorWaveSettingsSchema validates ranges strictly", () => {
  // Valid settings
  const valid = doctorWaveSettingsSchema.safeParse({
    waveWindowMinutes: 30,
    waveCapacity: 3,
    arrivalBufferMinutes: 15,
    autoPublishWaves: false,
  });
  assert.equal(valid.success, true);

  // Invalid: windowMinutes < 5
  const invalidWindow = doctorWaveSettingsSchema.safeParse({
    waveWindowMinutes: 2,
    waveCapacity: 3,
    arrivalBufferMinutes: 15,
    autoPublishWaves: false,
  });
  assert.equal(invalidWindow.success, false);

  // Invalid: negative buffer
  const invalidBuffer = doctorWaveSettingsSchema.safeParse({
    waveWindowMinutes: 30,
    waveCapacity: 3,
    arrivalBufferMinutes: -5,
    autoPublishWaves: false,
  });
  assert.equal(invalidBuffer.success, false);
});

test("createDoctorManualWaveSchema requires windowEndTime > windowStartTime", () => {
  const invalidTime = createDoctorManualWaveSchema.safeParse({
    dateStr: "2026-10-29",
    windowStartTime: "11:00",
    windowEndTime: "10:00", // before start
    capacity: 3,
  });
  assert.equal(invalidTime.success, false);

  const equalTime = createDoctorManualWaveSchema.safeParse({
    dateStr: "2026-10-29",
    windowStartTime: "10:00",
    windowEndTime: "10:00", // equal
    capacity: 3,
  });
  assert.equal(equalTime.success, false);

  const valid = createDoctorManualWaveSchema.safeParse({
    dateStr: "2026-10-29",
    windowStartTime: "10:00",
    windowEndTime: "11:00",
    capacity: 3,
  });
  assert.equal(valid.success, true);
});

test("generateDoctorWavesSchema, publishDoctorWaveSchema, reassignDoctorWaveAppointmentSchema, deleteDoctorDraftWaveSchema validate input correctly", () => {
  // Generate schema
  assert.equal(generateDoctorWavesSchema.safeParse({ dateStr: "2026-10-29", publishNow: true }).success, true);
  assert.equal(generateDoctorWavesSchema.safeParse({ dateStr: "invalid-date" }).success, false);

  // Publish schema
  assert.equal(publishDoctorWaveSchema.safeParse({ waveId: "w1" }).success, true);
  assert.equal(publishDoctorWaveSchema.safeParse({ waveId: "" }).success, false);

  // Reassign schema
  assert.equal(reassignDoctorWaveAppointmentSchema.safeParse({ appointmentId: "a1", targetWaveId: "w2" }).success, true);
  assert.equal(reassignDoctorWaveAppointmentSchema.safeParse({ appointmentId: "a1", targetWaveId: null }).success, true);
  assert.equal(reassignDoctorWaveAppointmentSchema.safeParse({ appointmentId: "" }).success, false);

  // Delete schema
  assert.equal(deleteDoctorDraftWaveSchema.safeParse({ waveId: "w1" }).success, true);
  assert.equal(deleteDoctorDraftWaveSchema.safeParse({ waveId: "" }).success, false);
});

