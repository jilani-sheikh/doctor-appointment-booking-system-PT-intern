import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
  });
  const apply = process.argv.includes("--apply");

  try {
    const pending = await db.notificationDelivery.count({
      where: { channel: "WHATSAPP", status: "PENDING" },
    });

    if (!apply) {
      console.log(`Dry run: ${pending} pending WhatsApp delivery row(s) would be cancelled.`);
    } else {
      const result = await db.notificationDelivery.updateMany({
        where: { channel: "WHATSAPP", status: "PENDING" },
        data: {
          status: "CANCELLED",
          lastError: "WhatsApp integration removed",
        },
      });
      console.log(`Cancelled ${result.count} pending WhatsApp delivery row(s).`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
