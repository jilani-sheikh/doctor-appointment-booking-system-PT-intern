import { z } from "zod";
import { DEFAULT_CASHFREE_API_VERSION, DEFAULT_REMINDER_OFFSETS_MINUTES } from "@/lib/constants";

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

  ADMIN_EMAILS: z.string().optional(),

  // Payments & Notifications configuration
  PAYMENTS_MODE: z.enum(["disabled", "cashfree"]).default("disabled"),
  APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  CASHFREE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  CASHFREE_API_VERSION: z.string().default(DEFAULT_CASHFREE_API_VERSION),
  CASHFREE_KEY_ID: z.string().optional(),
  CASHFREE_APP_ID: z.string().optional(),
  CASHFREE_SECRET: z.string().optional(),
  CASHFREE_SECRET_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  REMINDER_OFFSETS_MINUTES: z.string().optional(),
  WHATSAPP_PROVIDER: z.enum(["twilio"]).default("twilio"),
  WHATSAPP_MODE: z.enum(["disabled", "twilio"]).default("disabled"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  WHATSAPP_DEFAULT_COUNTRY_CODE: z.string().default("91"),
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
 * Lazily retrieves and normalizes configured admin emails.
 * Splits comma-separated values, trims whitespace, and converts to lowercase.
 */
export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Checks whether the given email is configured as an administrator.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return getAdminEmails().includes(normalized);
}

/**
 * Retrieves the application Payments Mode.
 * Defaults to "disabled" (auto-confirms bookings without payment rows).
 * Only "cashfree" switches to online payment flow.
 */
export function getPaymentsMode(): "disabled" | "cashfree" {
  const raw = process.env.PAYMENTS_MODE?.trim().toLowerCase();
  if (raw === "cashfree") {
    return "cashfree";
  }
  return "disabled";
}

/**
 * Lazily retrieves the canonical application base URL without trailing slash.
 * Reads APP_URL first, then NEXT_PUBLIC_APP_URL, defaulting to "http://localhost:3000".
 */
export function getAppUrl(): string {
  const raw = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export function getWhatsAppMode(): "disabled" | "twilio" {
  return process.env.WHATSAPP_MODE?.trim().toLowerCase() === "twilio" ? "twilio" : "disabled";
}

export function getWhatsAppProvider(): "twilio" {
  return "twilio";
}

function requiredWhatsAppVariable(
  name:
    | "TWILIO_ACCOUNT_SID"
    | "TWILIO_AUTH_TOKEN"
    | "TWILIO_WHATSAPP_FROM"
    | "TWILIO_WHATSAPP_CONTENT_SID_APPOINTMENT_CONFIRMED"
    | "TWILIO_WHATSAPP_CONTENT_SID_APPOINTMENT_CANCELLED"
    | "TWILIO_WHATSAPP_CONTENT_SID_APPOINTMENT_RESCHEDULED"
    | "TWILIO_WHATSAPP_CONTENT_SID_ARRIVAL_WINDOW"
    | "TWILIO_WHATSAPP_CONTENT_SID_APPOINTMENT_REMINDER"
    | "TWILIO_WHATSAPP_CONTENT_SID_PAYMENT_RECEIPT"
    | "TWILIO_WHATSAPP_CONTENT_SID_REFUND_UPDATE"
): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[Medrella Config Error] Missing required environment variable: ${name}. Configure ${name} to enable WhatsApp notifications.`);
  }
  return value;
}

export function getTwilioConfig() {
  return {
    accountSid: requiredWhatsAppVariable("TWILIO_ACCOUNT_SID"),
    authToken: requiredWhatsAppVariable("TWILIO_AUTH_TOKEN"),
    from: requiredWhatsAppVariable("TWILIO_WHATSAPP_FROM"),
  };
}

export type TwilioWhatsAppTemplate =
  | "appointment_confirmed"
  | "appointment_cancelled"
  | "appointment_rescheduled"
  | "arrival_window"
  | "appointment_reminder"
  | "payment_receipt"
  | "refund_update";

const TWILIO_CONTENT_SID_VARIABLES: Record<TwilioWhatsAppTemplate, Parameters<typeof requiredWhatsAppVariable>[0]> = {
  appointment_confirmed: "TWILIO_WHATSAPP_CONTENT_SID_APPOINTMENT_CONFIRMED",
  appointment_cancelled: "TWILIO_WHATSAPP_CONTENT_SID_APPOINTMENT_CANCELLED",
  appointment_rescheduled: "TWILIO_WHATSAPP_CONTENT_SID_APPOINTMENT_RESCHEDULED",
  arrival_window: "TWILIO_WHATSAPP_CONTENT_SID_ARRIVAL_WINDOW",
  appointment_reminder: "TWILIO_WHATSAPP_CONTENT_SID_APPOINTMENT_REMINDER",
  payment_receipt: "TWILIO_WHATSAPP_CONTENT_SID_PAYMENT_RECEIPT",
  refund_update: "TWILIO_WHATSAPP_CONTENT_SID_REFUND_UPDATE",
};

export function getTwilioWhatsAppContentSid(template: TwilioWhatsAppTemplate): string {
  const variable = TWILIO_CONTENT_SID_VARIABLES[template];
  const value = requiredWhatsAppVariable(variable);
  if (!/^HX[0-9a-fA-F]{32}$/.test(value)) {
    throw new Error(
      `[Medrella Config Error] Invalid ${variable}. Configure the approved Twilio Content Template SID (HX...) for ${template}.`
    );
  }
  return value;
}

export function getWhatsAppDefaultCountryCode(): string {
  const value = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() || "91";
  if (!/^\d{1,3}$/.test(value)) {
    throw new Error("[Medrella Config Error] Invalid WHATSAPP_DEFAULT_COUNTRY_CODE. Configure a numeric country code.");
  }
  return value;
}

/**
 * Lazily retrieves Cashfree Client ID (App ID).
 * Accepts CASHFREE_KEY_ID (canonical) with fallback to CASHFREE_APP_ID.
 */
export function getCashfreeKeyId(): string {
  const keyId = process.env.CASHFREE_KEY_ID?.trim() || process.env.CASHFREE_APP_ID?.trim();
  if (!keyId) {
    throw new Error(
      "[Medrella Config Error] Missing required environment variable: CASHFREE_KEY_ID\n" +
      "Please configure CASHFREE_KEY_ID (or CASHFREE_APP_ID) in your environment variables."
    );
  }
  return keyId;
}

/**
 * Lazily retrieves Cashfree Secret Key.
 * Accepts CASHFREE_SECRET (canonical) with fallback to CASHFREE_SECRET_KEY.
 */
export function getCashfreeSecret(): string {
  const secret = process.env.CASHFREE_SECRET?.trim() || process.env.CASHFREE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error(
      "[Medrella Config Error] Missing required environment variable: CASHFREE_SECRET\n" +
      "Please configure CASHFREE_SECRET (or CASHFREE_SECRET_KEY) in your environment variables."
    );
  }
  return secret;
}

/**
 * Check whether Cashfree credentials are configured without throwing.
 */
export function isCashfreeConfigured(): boolean {
  const keyId = process.env.CASHFREE_KEY_ID?.trim() || process.env.CASHFREE_APP_ID?.trim();
  const secret = process.env.CASHFREE_SECRET?.trim() || process.env.CASHFREE_SECRET_KEY?.trim();
  return Boolean(keyId && secret);
}

/**
 * Retrieves Cashfree Environment: "sandbox" (default) or "production".
 * Production is refused unless explicitly set to "production".
 */
export function getCashfreeEnv(): "sandbox" | "production" {
  const raw = process.env.CASHFREE_ENV?.trim().toLowerCase();
  if (raw === "production") {
    return "production";
  }
  return "sandbox";
}

/**
 * Retrieves Cashfree API Version header. Defaults to canonical "2023-08-01".
 */
export function getCashfreeApiVersion(): string {
  return process.env.CASHFREE_API_VERSION?.trim() || DEFAULT_CASHFREE_API_VERSION;
}

/**
 * Lazily retrieves Resend API Key.
 */
export function getResendApiKey(): string {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "[Medrella Config Error] Missing required environment variable: RESEND_API_KEY\n" +
      "Please configure RESEND_API_KEY in your environment variables."
    );
  }
  return apiKey;
}

/**
 * Check whether Resend is configured without throwing.
 */
export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0);
}

/**
 * Retrieves the Resend sender email address.
 * Accepts RESEND_FROM_EMAIL (canonical) with fallback to EMAIL_FROM.
 * Defaults to "onboarding@resend.dev".
 */
export function getResendFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    "onboarding@resend.dev"
  );
}

/**
 * Lazily retrieves CRON_SECRET for securing /api/cron/tick.
 */
export function getCronSecret(): string {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "[Medrella Config Error] Missing required environment variable: CRON_SECRET\n" +
      "Please configure CRON_SECRET in your environment variables."
    );
  }
  return secret;
}

/**
 * Retrieves parsed reminder offsets in minutes prior to appointment start time.
 * Parses comma-separated string e.g. "1440,120".
 */
export function getReminderOffsetsMinutes(): number[] {
  const raw = process.env.REMINDER_OFFSETS_MINUTES?.trim();
  if (!raw) {
    return DEFAULT_REMINDER_OFFSETS_MINUTES;
  }
  const parsed = raw
    .split(",")
    .map((val) => parseInt(val.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
  return parsed.length > 0 ? parsed : DEFAULT_REMINDER_OFFSETS_MINUTES;
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
