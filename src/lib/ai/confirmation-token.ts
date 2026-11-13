import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { confirmActionTypeSchema, type ConfirmActionType } from "@/lib/ai/schemas";

export const DEFAULT_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export interface ConfirmationTokenClaims {
  v: 1;
  confirmationId: string;
  userId: string;
  role: "PATIENT" | "DOCTOR";
  action: ConfirmActionType;
  payload: Record<string, unknown>;
  payloadHash: string;
  issuedAt: number;
  expiresAt: number;
}

const confirmationClaimsSchema = z.object({
  v: z.literal(1),
  confirmationId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["PATIENT", "DOCTOR"]),
  action: confirmActionTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

/**
 * Recursively normalizes JSON-like structures with sorted object keys so
 * payload hashes are identical regardless of key insertion order.
 */
export function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      normalized[k] = canonicalizeValue(v);
    }
    return normalized;
  }
  return value;
}

/**
 * Computes a deterministic SHA-256 hex digest of an action and its parameters.
 */
export function hashConfirmationPayload(
  action: ConfirmActionType,
  payload: Record<string, unknown>
): string {
  const canonical = JSON.stringify(canonicalizeValue({ action, payload }));
  return createHash("sha256").update(canonical).digest("hex");
}

function signSegment(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

/**
 * Issues an HMAC-SHA256 signed confirmation token bound to the user, role, action, and payload.
 */
export function signConfirmationToken(
  input: {
    confirmationId: string;
    userId: string;
    role: "PATIENT" | "DOCTOR";
    action: ConfirmActionType;
    payload: Record<string, unknown>;
    issuedAt?: number;
    expiresAt?: number;
  },
  secret: string
): { token: string; claims: ConfirmationTokenClaims } {
  const issuedAt = input.issuedAt ?? Date.now();
  const expiresAt = input.expiresAt ?? issuedAt + DEFAULT_CONFIRMATION_TTL_MS;
  const payloadHash = hashConfirmationPayload(input.action, input.payload);

  const claims: ConfirmationTokenClaims = {
    v: 1,
    confirmationId: input.confirmationId,
    userId: input.userId,
    role: input.role,
    action: input.action,
    payload: canonicalizeValue(input.payload) as Record<string, unknown>,
    payloadHash,
    issuedAt,
    expiresAt,
  };

  const encodedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = signSegment(encodedPayload, secret);
  return {
    token: `${encodedPayload}.${signature}`,
    claims,
  };
}

export type VerifyTokenResult =
  | { ok: true; claims: ConfirmationTokenClaims }
  | { ok: false; code: "INVALID_FORMAT" | "INVALID_SIGNATURE" | "EXPIRED" | "FORBIDDEN"; error: string };

/**
 * Verifies an AI action confirmation token's HMAC signature, expiration, owner identity, and payload hash.
 */
export function verifyConfirmationToken(input: {
  token: string;
  expectedUserId: string;
  expectedRole: "PATIENT" | "DOCTOR";
  secret: string;
  now?: number;
}): VerifyTokenResult {
  const parts = input.token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, code: "INVALID_FORMAT", error: "Malformed confirmation token." };
  }

  const [encodedPayload, providedSig] = parts;
  const expectedSig = signSegment(encodedPayload, input.secret);

  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, code: "INVALID_SIGNATURE", error: "Invalid confirmation signature." };
  }

  let parsedRaw: unknown;
  try {
    const json = Buffer.from(encodedPayload, "base64url").toString("utf8");
    parsedRaw = JSON.parse(json);
  } catch {
    return { ok: false, code: "INVALID_FORMAT", error: "Unreadable confirmation payload." };
  }

  const parsed = confirmationClaimsSchema.safeParse(parsedRaw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_FORMAT", error: "Invalid confirmation claims." };
  }

  const claims = parsed.data;
  const now = input.now ?? Date.now();
  if (now > claims.expiresAt) {
    return {
      ok: false,
      code: "EXPIRED",
      error: "This confirmation request has expired. Please ask the assistant to prepare it again.",
    };
  }

  if (claims.userId !== input.expectedUserId || claims.role !== input.expectedRole) {
    return {
      ok: false,
      code: "FORBIDDEN",
      error: "You are not authorized to confirm this action.",
    };
  }

  const expectedHash = hashConfirmationPayload(claims.action, claims.payload);
  const actualHashBuf = Buffer.from(claims.payloadHash, "utf8");
  const expectedHashBuf = Buffer.from(expectedHash, "utf8");
  if (
    actualHashBuf.length !== expectedHashBuf.length ||
    !timingSafeEqual(actualHashBuf, expectedHashBuf)
  ) {
    return { ok: false, code: "INVALID_SIGNATURE", error: "Confirmation payload integrity check failed." };
  }

  return { ok: true, claims };
}

