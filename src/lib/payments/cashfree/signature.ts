import crypto from "crypto";
import { WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS } from "@/lib/constants";
import type { WebhookHeaders, WebhookVerificationResult } from "../types";

/**
 * Parses timestamp from header (supports epoch in milliseconds, epoch in seconds, or ISO string).
 */
export function parseWebhookTimestamp(rawTimestamp: string): number | null {
  if (!rawTimestamp) return null;
  const trimmed = rawTimestamp.trim();

  // Pure numeric string
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    // If < 10000000000, it's seconds; convert to ms
    if (num < 10000000000) {
      return num * 1000;
    }
    return num;
  }

  // Attempt ISO 8601 date parse
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return parsed;
  }

  return null;
}

/**
 * Computes Cashfree webhook HMAC-SHA256 Base64 signature.
 * Formula: Base64(HMAC-SHA256(timestamp + rawBody, secretKey))
 */
export function computeCashfreeSignature(timestamp: string, rawBody: string, secretKey: string): string {
  const signatureData = timestamp + rawBody;
  return crypto.createHmac("sha256", secretKey).update(signatureData, "utf8").digest("base64");
}

/**
 * Verifies incoming Cashfree webhook signature and timestamp bounds (replay protection).
 * Uses constant-time buffer comparison to prevent timing attacks.
 */
export function verifyCashfreeWebhookSignature(
  headers: WebhookHeaders,
  rawBody: string,
  secretKey: string,
  now: Date = new Date()
): WebhookVerificationResult {
  const signature = headers.signature?.trim();
  const timestamp = headers.timestamp?.trim();

  if (!signature || !timestamp) {
    return { valid: false, reason: "MISSING_HEADERS" };
  }

  // 1. Replay protection: verify timestamp within 5-minute tolerance
  const timestampMs = parseWebhookTimestamp(timestamp);
  if (timestampMs === null) {
    return { valid: false, reason: "TIMESTAMP_OUT_OF_BOUNDS" };
  }

  const nowMs = now.getTime();
  const driftMs = Math.abs(nowMs - timestampMs);
  const maxDriftMs = WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS * 1000;

  if (driftMs > maxDriftMs) {
    return { valid: false, reason: "TIMESTAMP_OUT_OF_BOUNDS" };
  }

  // 2. Compute expected HMAC-SHA256 signature
  try {
    const expectedSignature = computeCashfreeSignature(timestamp, rawBody, secretKey);

    const sigBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (sigBuffer.length !== expectedBuffer.length) {
      return { valid: false, reason: "INVALID_SIGNATURE" };
    }

    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, reason: "INVALID_SIGNATURE" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "ERROR" };
  }
}
