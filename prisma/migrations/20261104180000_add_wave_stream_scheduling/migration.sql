CREATE TYPE "ScheduleType" AS ENUM ('WAVE', 'STREAM');
CREATE TYPE "Recurrence" AS ENUM ('ONCE', 'RECURRING');
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'CANCELLED');
CREATE TYPE "AvailabilityKind" AS ENUM ('SINGLE', 'WAVE_PARENT', 'WAVE_SLOT', 'STREAM_WINDOW');

CREATE TABLE "availability_schedules" (
  "id" TEXT NOT NULL,
  "doctor_id" TEXT NOT NULL,
  "type" "ScheduleType" NOT NULL,
  "recurrence" "Recurrence" NOT NULL,
  "start_date" TEXT NOT NULL,
  "end_date" TEXT NOT NULL,
  "days_of_week" INTEGER[] NOT NULL,
  "start_minute" INTEGER NOT NULL,
  "end_minute" INTEGER NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL,
  "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "availability_schedules_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "availability_exceptions" (
  "id" TEXT NOT NULL,
  "doctor_id" TEXT NOT NULL,
  "schedule_id" TEXT,
  "date" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "availabilities"
  ADD COLUMN "kind" "AvailabilityKind" NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "active_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "schedule_id" TEXT,
  ADD COLUMN "parent_id" TEXT,
  ADD COLUMN "exception_id" TEXT;
ALTER TABLE "appointments"
  ADD COLUMN "slot_start" TIMESTAMP(3),
  ADD COLUMN "slot_end" TIMESTAMP(3);
UPDATE "availabilities" a
SET "active_count" = (
  SELECT COUNT(*) FROM "appointments" ap
  WHERE ap."availability_id" = a."id" AND ap."status" <> 'CANCELLED'
);
ALTER TABLE "availability_schedules"
  ADD CONSTRAINT "availability_schedules_doctor_id_fkey"
  FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "availability_exceptions"
  ADD CONSTRAINT "availability_exceptions_doctor_id_fkey"
  FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "availability_exceptions_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "availability_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "availabilities"
  ADD CONSTRAINT "availabilities_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "availability_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "availabilities_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "availabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "availabilities_exception_id_fkey"
  FOREIGN KEY ("exception_id") REFERENCES "availability_exceptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "availability_schedules_doctor_id_status_idx" ON "availability_schedules"("doctor_id", "status");
CREATE UNIQUE INDEX "availability_exceptions_schedule_id_date_key" ON "availability_exceptions"("schedule_id", "date");
CREATE INDEX "availability_exceptions_doctor_id_date_idx" ON "availability_exceptions"("doctor_id", "date");
CREATE UNIQUE INDEX "availabilities_doctor_id_start_time_kind_key" ON "availabilities"("doctor_id", "start_time", "kind");
CREATE INDEX "availabilities_schedule_id_idx" ON "availabilities"("schedule_id");
CREATE INDEX "availabilities_parent_id_idx" ON "availabilities"("parent_id");
CREATE INDEX "availabilities_exception_id_idx" ON "availabilities"("exception_id");
