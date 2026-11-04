CREATE UNIQUE INDEX "appointments_availability_id_patient_id_active_unique"
  ON "appointments"("availability_id", "patient_id")
  WHERE "status" <> 'CANCELLED';
CREATE UNIQUE INDEX "appointments_availability_id_slot_start_active_unique"
  ON "appointments"("availability_id", "slot_start")
  WHERE "status" <> 'CANCELLED' AND "slot_start" IS NOT NULL;
ALTER TABLE "availabilities"
  ADD CONSTRAINT "availabilities_capacity_positive" CHECK ("capacity" > 0),
  ADD CONSTRAINT "availabilities_active_count_nonnegative" CHECK ("active_count" >= 0);
ALTER TABLE "availability_schedules"
  ADD CONSTRAINT "availability_schedules_valid_window" CHECK ("end_minute" > "start_minute" AND "duration_minutes" > 0 AND "capacity" > 0);
DROP INDEX "appointments_availability_id_active_unique";
DROP INDEX "availabilities_doctor_id_start_time_key";
