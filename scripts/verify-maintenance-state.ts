import dotenv from "dotenv";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import ws from "ws";

dotenv.config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing");
}

const client = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 }),
});

async function main() {
  const maintenanceTable = await client.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'maintenance_state'
    ) AS "exists";
  `;
  const indexes = await client.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname::text, indexdef::text
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'appointments_availability_id_active_unique';
  `;
  const migrations = await client.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null; logs: string | null }>>`
    SELECT migration_name::text, finished_at, rolled_back_at, logs::text
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
    ORDER BY started_at;
  `;
  const paymentCounts = await client.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT status::text AS status, COUNT(*)::bigint AS count
    FROM payments
    GROUP BY status
    ORDER BY status::text;
  `;
  const deliveryCounts = await client.$queryRaw<Array<{ channel: string; status: string; count: bigint }>>`
    SELECT channel::text AS channel, status::text AS status, COUNT(*)::bigint AS count
    FROM notification_deliveries
    GROUP BY channel, status
    ORDER BY channel::text, status::text;
  `;

  console.log(JSON.stringify({
    maintenanceStateTableExists: maintenanceTable[0]?.exists === true,
    partialIndex: indexes[0] ?? null,
    failedOrUnfinishedMigrations: migrations.map((migration) => ({
      migrationName: migration.migration_name,
      finished: migration.finished_at !== null,
      rolledBack: migration.rolled_back_at !== null,
      hasLogs: Boolean(migration.logs),
    })),
    paymentCounts: paymentCounts.map((row) => ({ status: row.status, count: Number(row.count) })),
    notificationDeliveryCounts: deliveryCounts.map((row) => ({
      channel: row.channel,
      status: row.status,
      count: Number(row.count),
    })),
  }, null, 2));
}

main().finally(async () => {
  await client.$disconnect();
});
