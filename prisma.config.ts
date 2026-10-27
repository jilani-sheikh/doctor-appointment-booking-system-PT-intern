import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "prisma/config";

// Explicitly load .env.local for local Prisma CLI operations if it exists
const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  config({ path: envLocalPath });
}

// Strictly enforce DIRECT_URL for commands that apply migrations to a database
const isDatabaseMigrationCommand =
  process.argv.includes("dev") ||
  process.argv.includes("deploy") ||
  process.argv.includes("reset");

const directUrl = process.env.DIRECT_URL;

if (isDatabaseMigrationCommand && (!directUrl || directUrl.trim() === "")) {
  throw new Error(
    "\n[Medrella Prisma Error] Missing required environment variable: DIRECT_URL\n" +
    "Prisma migrations must be executed over Neon's direct (non-pooled) connection.\n" +
    "Please set DIRECT_URL in your .env.local file.\n"
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // For non-migration/offline commands (e.g. prisma generate or schema diff), allow an empty string fallback
    url: directUrl || "",
  },
});
