import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

async function checkDeliveries() {
  const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  try {
    const deliveries = await db.notificationDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        template: true,
        status: true,
        attempts: true,
        lastError: true,
        scheduledFor: true,
        appointmentId: true,
        createdAt: true,
      },
    });

    console.log(`Found ${deliveries.length} recent notification delivery records:`);
    for (const d of deliveries) {
      console.log(`- ID: ${d.id}`);
      console.log(`  Template: ${d.template}`);
      console.log(`  Status: ${d.status}`);
      console.log(`  Attempts: ${d.attempts}`);
      console.log(`  Last Error: ${d.lastError || "none"}`);
      console.log(`  Scheduled For: ${d.scheduledFor.toISOString()}`);
      console.log(`  Appointment ID: ${d.appointmentId}`);
      console.log(`  Created At: ${d.createdAt.toISOString()}`);
      console.log("");
    }
  } finally {
    await db.$disconnect();
  }
}

checkDeliveries().catch(console.error);
