-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CALLED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'QUEUE_CALLED';

-- AlterTable
ALTER TABLE "availabilities"
ADD COLUMN IF NOT EXISTS "token_counter" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "appointments"
ADD COLUMN IF NOT EXISTS "token_number" INTEGER,
ADD COLUMN IF NOT EXISTS "queue_scope_key" TEXT,
ADD COLUMN IF NOT EXISTS "called_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "called_by_user_id" TEXT,
ADD COLUMN IF NOT EXISTS "no_show_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "no_show_by_user_id" TEXT,
ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "completed_by_user_id" TEXT;

-- Backfill persistent per-sub-slot queue scope keys and tokens for existing confirmed/historical rows.
-- Offset ROW_NUMBER() by any already-allocated max token_number per availability so partial retries remain conflict-free.
WITH existing_max AS (
  SELECT
    "availability_id",
    COALESCE(MAX("token_number"), 0) AS max_token
  FROM "appointments"
  GROUP BY "availability_id"
),
ranked AS (
  SELECT
    ap."id",
    ap."availability_id",
    av."doctor_id" || ':' || to_char(av."start_time" + INTERVAL '5 hours 30 minutes', 'YYYY-MM-DD') || ':' || ap."availability_id" AS scope_key,
    COALESCE(em.max_token, 0) + ROW_NUMBER() OVER (
      PARTITION BY ap."availability_id"
      ORDER BY ap."created_at" ASC, ap."id" ASC
    ) AS seq_num
  FROM "appointments" ap
  INNER JOIN "availabilities" av ON av."id" = ap."availability_id"
  LEFT JOIN existing_max em ON em."availability_id" = ap."availability_id"
  WHERE ap."status" <> 'PENDING_PAYMENT'::"AppointmentStatus"
    AND (ap."queue_scope_key" IS NULL OR ap."token_number" IS NULL)
)
UPDATE "appointments" ap
SET
  "queue_scope_key" = ranked.scope_key,
  "token_number" = ranked.seq_num
FROM ranked
WHERE ap."id" = ranked."id";

-- Sync availability token_counter to max issued token number per availability
UPDATE "availabilities" av
SET "token_counter" = GREATEST(
  av."token_counter",
  COALESCE(
    (
      SELECT MAX(ap."token_number")
      FROM "appointments" ap
      WHERE ap."availability_id" = av."id"
    ),
    0
  )
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "appointments_queue_scope_key_idx" ON "appointments"("queue_scope_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_queue_scope_key_token_number_key" ON "appointments"("queue_scope_key", "token_number");

