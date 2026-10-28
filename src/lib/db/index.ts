import "server-only";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseUrl } from "@/lib/env";
import ws from "ws";

// Configure Neon to use WebSocket constructor in Node.js runtime
neonConfig.webSocketConstructor = ws;

declare global {
  var __medrella_prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = getDatabaseUrl();
  const adapter = new PrismaNeon({
    connectionString,
    connectionTimeoutMillis: 10000,
  });
  return new PrismaClient({ adapter });
}

function getPrismaInstance(): PrismaClient {
  if (!globalThis.__medrella_prisma) {
    globalThis.__medrella_prisma = createPrismaClient();
  }
  return globalThis.__medrella_prisma;
}

/**
 * Lazy Server-Only Database Client.
 *
 * Utilizes a JavaScript Proxy so that merely importing `db` does NOT evaluate
 * DATABASE_URL or instantiate PrismaClient at module load time or during static Next.js compilation.
 * The environment variable and database client are only initialized when an actual
 * database operation is performed.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaInstance();
    return Reflect.get(client, prop);
  },
});
