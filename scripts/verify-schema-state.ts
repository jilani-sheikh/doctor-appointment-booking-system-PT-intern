import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("No DATABASE_URL configured.");
    return;
  }
  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  const indexCheck: Array<{ indexname: string; indexdef: string }> = await db.$queryRaw`
    SELECT indexname::text AS indexname, indexdef::text AS indexdef
    FROM pg_indexes
    WHERE tablename = 'appointments'
      AND indexname = 'appointments_availability_id_active_unique';
  `;

  console.log("Partial Index check result:", indexCheck);

  const legacyWavesCount = await db.wave.count({
    where: { doctorId: null },
  });
  console.log("Legacy waves count (doctorId is null):", legacyWavesCount);

  const doctorColumnsCheck: Array<{ column_name: string; data_type: string; column_default: string }> = await db.$queryRaw`
    SELECT column_name::text AS column_name, data_type::text AS data_type, column_default::text AS column_default
    FROM information_schema.columns
    WHERE table_name = 'doctors'
      AND column_name IN ('wave_window_minutes', 'wave_capacity', 'arrival_buffer_minutes', 'auto_publish_waves');
  `;
  console.log("Doctor wave columns:", doctorColumnsCheck);

  const waveDoctorIdCheck: Array<{ column_name: string; is_nullable: string }> = await db.$queryRaw`
    SELECT column_name::text AS column_name, is_nullable::text AS is_nullable
    FROM information_schema.columns
    WHERE table_name = 'waves'
      AND column_name = 'doctor_id';
  `;
  console.log("Wave doctor_id column:", waveDoctorIdCheck);

  await db.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
