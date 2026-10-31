CREATE TABLE "maintenance_state" (
    "key" TEXT NOT NULL,
    "last_started_at" TIMESTAMP(3),
    "lock_until" TIMESTAMP(3),
    CONSTRAINT "maintenance_state_pkey" PRIMARY KEY ("key")
);

INSERT INTO "maintenance_state" ("key") VALUES ('global');
