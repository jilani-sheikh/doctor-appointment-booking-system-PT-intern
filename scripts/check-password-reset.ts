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
  const now = new Date();
  const [total, used, expired, active, deliveries] = await Promise.all([
    client.passwordResetToken.count(),
    client.passwordResetToken.count({ where: { usedAt: { not: null } } }),
    client.passwordResetToken.count({ where: { usedAt: null, expiresAt: { lte: now } } }),
    client.passwordResetToken.count({ where: { usedAt: null, expiresAt: { gt: now } } }),
    client.notificationDelivery.findMany({
      where: { template: "password_reset" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        attempts: true,
        lastError: true,
        scheduledFor: true,
      },
    }),
  ]);

  console.log(JSON.stringify({
    passwordResetTokens: { total, used, expired, active },
    resetDeliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      status: delivery.status,
      attempts: delivery.attempts,
      lastError: delivery.lastError,
      scheduledFor: delivery.scheduledFor.toISOString(),
    })),
  }, null, 2));
}

main().catch(() => {
  console.warn("[Password Reset Check] Inspection failed: database query error");
  process.exitCode = 1;
}).finally(async () => {
  await client.$disconnect();
});
