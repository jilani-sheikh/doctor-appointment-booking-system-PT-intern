-- CreateEnum
CREATE TYPE "VisitStream" AS ENUM ('NEW_CONSULTATION', 'FOLLOW_UP', 'PRIORITY');

-- CreateEnum
CREATE TYPE "WaveStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED', 'DOCTOR_ABSENCE', 'SLOT_AVAILABLE', 'WAVE_PUBLISHED', 'QUEUE_DELAY', 'GENERAL');

-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'CHECKED_IN';
ALTER TYPE "AppointmentStatus" ADD VALUE 'IN_CONSULTATION';

-- AlterTable
ALTER TABLE "availabilities" ADD COLUMN     "blocked_by_time_off_id" TEXT;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "actual_end_at" TIMESTAMP(3),
ADD COLUMN     "actual_start_at" TIMESTAMP(3),
ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "checked_in_by_user_id" TEXT,
ADD COLUMN     "delay_notified_at" TIMESTAMP(3),
ADD COLUMN     "disrupted_at" TIMESTAMP(3),
ADD COLUMN     "disruption_reason" TEXT,
ADD COLUMN     "reschedule_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rescheduled_from_availability_id" TEXT,
ADD COLUMN     "stream" "VisitStream" NOT NULL DEFAULT 'NEW_CONSULTATION',
ADD COLUMN     "wave_id" TEXT;

-- CreateTable
CREATE TABLE "waves" (
    "id" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "stream" "VisitStream",
    "status" "WaveStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_time_off" (
    "id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "earliest_date" TIMESTAMP(3) NOT NULL,
    "latest_date" TIMESTAMP(3) NOT NULL,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waves_specialization_window_start_idx" ON "waves"("specialization", "window_start");

-- CreateIndex
CREATE INDEX "doctor_time_off_doctor_id_start_at_idx" ON "doctor_time_off"("doctor_id", "start_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "waitlist_entries_doctor_id_earliest_date_latest_date_idx" ON "waitlist_entries"("doctor_id", "earliest_date", "latest_date");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_patient_id_doctor_id_key" ON "waitlist_entries"("patient_id", "doctor_id");

-- CreateIndex
CREATE INDEX "availabilities_blocked_by_time_off_id_idx" ON "availabilities"("blocked_by_time_off_id");

-- CreateIndex
CREATE INDEX "appointments_wave_id_idx" ON "appointments"("wave_id");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

-- CreateIndex
CREATE INDEX "appointments_rescheduled_from_availability_id_idx" ON "appointments"("rescheduled_from_availability_id");

-- AddForeignKey
ALTER TABLE "availabilities" ADD CONSTRAINT "availabilities_blocked_by_time_off_id_fkey" FOREIGN KEY ("blocked_by_time_off_id") REFERENCES "doctor_time_off"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_availability_id_fkey" FOREIGN KEY ("rescheduled_from_availability_id") REFERENCES "availabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "waves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waves" ADD CONSTRAINT "waves_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "waves" ADD CONSTRAINT "waves_check_end_after_start" CHECK ("window_end" > "window_start");

-- AddCheckConstraint
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_check_end_after_start" CHECK ("end_at" > "start_at");
