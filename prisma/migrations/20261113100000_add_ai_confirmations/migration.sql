CREATE TYPE "AiConfirmationStatus" AS ENUM ('PENDING', 'CONSUMING', 'EXECUTED', 'FAILED');

CREATE TABLE "ai_confirmations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "status" "AiConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_confirmations_user_id_status_expires_at_idx" ON "ai_confirmations"("user_id", "status", "expires_at");

CREATE INDEX "ai_confirmations_expires_at_idx" ON "ai_confirmations"("expires_at");

ALTER TABLE "ai_confirmations"
  ADD CONSTRAINT "ai_confirmations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

