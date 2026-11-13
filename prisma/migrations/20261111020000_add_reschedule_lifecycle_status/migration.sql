CREATE TYPE "RescheduleLifecycleStatus" AS ENUM ('PENDING_RESCHEDULING', 'RESCHEDULED', 'RESOLVED_MANUALLY');

ALTER TABLE "appointments"
  ADD COLUMN "reschedule_status" "RescheduleLifecycleStatus";

