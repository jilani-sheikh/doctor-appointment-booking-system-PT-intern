import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
try {
  const rows = await db.notificationDelivery.groupBy({
    by: ["template", "status"],
    where: { channel: "WHATSAPP" },
    _count: { _all: true },
  });
  const errors = await db.notificationDelivery.findMany({
    where: { channel: "WHATSAPP", lastError: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { template: true, status: true, lastError: true },
  });
  for (const row of rows) console.log(`${row.template} ${row.status}: ${row._count._all}`);
  for (const row of errors) console.log(`${row.template} ${row.status}: ${row.lastError}`);
} finally {
  await db.$disconnect();
}
