import dotenv from "dotenv";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import ws from "ws";

dotenv.config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is missing");

const client = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 }),
});

async function main() {
  const tables = await client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name::text
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'password_reset_tokens'
  `;
  const columns = await client.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name IN ('password_changed_at', 'deleted_at')
    ORDER BY column_name
  `;
  const indexes = await client.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname::text, indexdef::text
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'appointments_availability_id_active_unique'
  `;
  const migrations = await client.$queryRaw<Array<{
    migration_name: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
  }>>`
    SELECT migration_name::text, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
    ORDER BY started_at
  `;

  console.log(JSON.stringify({
    passwordResetTokensExists: tables.length === 1,
    userColumns: columns.map((column) => column.column_name),
    partialIndex: indexes[0] ?? null,
    failedOrUnfinishedMigrations: migrations.map((migration) => ({
      migrationName: migration.migration_name,
      finished: migration.finished_at !== null,
      rolledBack: migration.rolled_back_at !== null,
    })),
  }, null, 2));
}

main().catch(() => {
  console.warn("[Password Reset DB Check] Verification failed: database query error");
  process.exitCode = 1;
}).finally(async () => {
  await client.$disconnect();
});
