import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { getDatabaseUrl } from "@/lib/env";

type NeonClient = NeonQueryFunction<false, false>;

let cachedNeon: NeonClient | null = null;

function getNeonClient(): NeonClient {
  if (!cachedNeon) {
    const url = getDatabaseUrl();
    cachedNeon = neon(url);
  }
  return cachedNeon;
}

/**
 * Lazy Neon query function.
 * Evaluates DATABASE_URL and initializes the HTTP client only when
 * an actual SQL query is dispatched to the database.
 */
const lazyQueryClient: NeonClient = ((
  ...args: Parameters<NeonClient>
): ReturnType<NeonClient> => {
  const client = getNeonClient();
  return Reflect.apply(client, undefined, args);
}) as NeonClient;

/**
 * Reusable server-only Drizzle database client.
 * Compatible with Drizzle's PgDatabase check and Auth.js Drizzle adapter.
 */
export const db: NeonHttpDatabase<typeof schema> = drizzle(lazyQueryClient, { schema });

export { schema };
