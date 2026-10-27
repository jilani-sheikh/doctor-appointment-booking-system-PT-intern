import { z } from "zod";

/**
 * Zod schema for required and optional environment variables.
 * Validation is executed lazily on demand, allowing the project to build
 * and public landing pages to render without pre-configured credentials.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string({
      required_error: "Missing required environment variable: DATABASE_URL. Please set DATABASE_URL (Neon pooled connection string) in your .env.local file.",
    })
    .min(1, "DATABASE_URL cannot be empty")
    .url("DATABASE_URL must be a valid PostgreSQL connection URL"),

  DIRECT_URL: z
    .string({
      required_error: "Missing required environment variable: DIRECT_URL. Please set DIRECT_URL (Neon direct connection string) in your .env.local file.",
    })
    .min(1, "DIRECT_URL cannot be empty")
    .url("DIRECT_URL must be a valid PostgreSQL connection URL")
    .optional(),

  AUTH_SECRET: z
    .string({
      required_error: "Missing required environment variable: AUTH_SECRET. Please set AUTH_SECRET in your .env.local file (generate with `npx auth secret`).",
    })
    .min(1, "AUTH_SECRET cannot be empty"),

  AUTH_GOOGLE_ID: z
    .string({
      required_error: "Missing required environment variable: AUTH_GOOGLE_ID. Please set AUTH_GOOGLE_ID in your .env.local file (from Google Cloud Console OAuth 2.0 Client IDs).",
    })
    .min(1, "AUTH_GOOGLE_ID cannot be empty"),

  AUTH_GOOGLE_SECRET: z
    .string({
      required_error: "Missing required environment variable: AUTH_GOOGLE_SECRET. Please set AUTH_GOOGLE_SECRET in your .env.local file (from Google Cloud Console OAuth 2.0 Client IDs).",
    })
    .min(1, "AUTH_GOOGLE_SECRET cannot be empty"),

  AUTH_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Check whether database credentials are configured without throwing.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

/**
 * Check whether Google OAuth credentials are configured without throwing.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET &&
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET
  );
}

/**
 * Lazily retrieves and validates DATABASE_URL (pooled runtime connection).
 * Throws a descriptive, actionable error naming the variable if missing.
 */
export function getDatabaseUrl(): string {
  const result = envSchema.shape.DATABASE_URL.safeParse(process.env.DATABASE_URL);
  if (!result.success) {
    const errorMsg = result.error.errors[0]?.message ?? "Invalid DATABASE_URL";
    throw new Error(`[Medrella Config Error] Missing or invalid variable: DATABASE_URL\n${errorMsg}`);
  }
  return result.data;
}

/**
 * Lazily retrieves and validates DIRECT_URL (direct non-pooled migration connection).
 * Required for executing Prisma migrations.
 */
export function getDirectUrl(): string {
  const result = envSchema.shape.DIRECT_URL.unwrap().safeParse(process.env.DIRECT_URL);
  if (!result.success || !process.env.DIRECT_URL) {
    throw new Error(
      "[Medrella Config Error] Missing required environment variable: DIRECT_URL\n" +
      "Prisma migrations must be executed over Neon's direct (non-pooled) connection.\n" +
      "Please set DIRECT_URL in your .env.local file (from your Neon console)."
    );
  }
  return result.data;
}

/**
 * Lazily retrieves and validates AUTH_SECRET.
 * During `next build` / static prerendering when no credentials exist, returns a build fallback
 * so build succeeds cleanly, but enforces presence at runtime when auth actions occur.
 */
export function getAuthSecret(): string {
  if (process.env.AUTH_SECRET) {
    const result = envSchema.shape.AUTH_SECRET.safeParse(process.env.AUTH_SECRET);
    if (!result.success) {
      throw new Error(`[Medrella Config Error] Invalid AUTH_SECRET: ${result.error.errors[0]?.message}`);
    }
    return result.data;
  }

  // If executing in build or static generation mode with no env set
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.NODE_ENV !== "production") {
    return "medrella_build_secret_fallback_key_32chars_long!!";
  }

  throw new Error(
    "[Medrella Config Error] Missing required environment variable: AUTH_SECRET\n" +
    "Please set AUTH_SECRET in your .env.local file (run `npx auth secret` to generate one)."
  );
}

/**
 * Lazily retrieves and validates Google OAuth credentials.
 */
export function getGoogleCredentials(): { clientId: string; clientSecret: string } {
  const idResult = envSchema.shape.AUTH_GOOGLE_ID.safeParse(process.env.AUTH_GOOGLE_ID);
  if (!idResult.success) {
    throw new Error(`[Medrella Config Error] Missing required environment variable: AUTH_GOOGLE_ID\n${idResult.error.errors[0]?.message}`);
  }

  const secretResult = envSchema.shape.AUTH_GOOGLE_SECRET.safeParse(process.env.AUTH_GOOGLE_SECRET);
  if (!secretResult.success) {
    throw new Error(`[Medrella Config Error] Missing required environment variable: AUTH_GOOGLE_SECRET\n${secretResult.error.errors[0]?.message}`);
  }

  return {
    clientId: idResult.data,
    clientSecret: secretResult.data,
  };
}

/**
 * Lazy validator for full application environment.
 */
export function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`[Medrella Config Error] Environment validation failed:\n${formatted}`);
  }
  return parsed.data;
}
