import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeCashfreeSignature,
  verifyCashfreeWebhookSignature,
} from "../src/lib/payments/cashfree/signature";

describe("Webhook Signature Verification & Replay Protection", () => {
  const secretKey = "test_cashfree_secret_key_12345";
  const rawBody = JSON.stringify({
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: {
      order: { order_id: "order_test_123", order_amount: 500 },
      payment: { cf_payment_id: "cf_pay_999", payment_status: "SUCCESS" },
    },
  });

  const baseNow = new Date("2026-10-30T10:00:00Z");

  it("verifies a valid signature with current timestamp", () => {
    const timestamp = baseNow.toISOString();
    const signature = computeCashfreeSignature(timestamp, rawBody, secretKey);

    const result = verifyCashfreeWebhookSignature(
      { signature, timestamp },
      rawBody,
      secretKey,
      baseNow
    );

    assert.equal(result.valid, true);
  });

  it("verifies a valid signature with numeric epoch timestamp in seconds", () => {
    const timestampSeconds = Math.floor(baseNow.getTime() / 1000).toString();
    const signature = computeCashfreeSignature(timestampSeconds, rawBody, secretKey);

    const result = verifyCashfreeWebhookSignature(
      { signature, timestamp: timestampSeconds },
      rawBody,
      secretKey,
      baseNow
    );

    assert.equal(result.valid, true);
  });

  it("rejects tampered payload body", () => {
    const timestamp = baseNow.toISOString();
    const signature = computeCashfreeSignature(timestamp, rawBody, secretKey);
    const tamperedBody = rawBody.replace("500", "100");

    const result = verifyCashfreeWebhookSignature(
      { signature, timestamp },
      tamperedBody,
      secretKey,
      baseNow
    );

    assert.equal(result.valid, false);
    assert.equal(result.reason, "INVALID_SIGNATURE");
  });

  it("rejects invalid signature calculated with wrong secret", () => {
    const timestamp = baseNow.toISOString();
    const signature = computeCashfreeSignature(timestamp, rawBody, "wrong_secret");

    const result = verifyCashfreeWebhookSignature(
      { signature, timestamp },
      rawBody,
      secretKey,
      baseNow
    );

    assert.equal(result.valid, false);
    assert.equal(result.reason, "INVALID_SIGNATURE");
  });

  it("rejects stale timestamp more than 5 minutes in the past", () => {
    // 6 minutes in the past (360 seconds)
    const staleTime = new Date(baseNow.getTime() - 360 * 1000);
    const timestamp = staleTime.toISOString();
    const signature = computeCashfreeSignature(timestamp, rawBody, secretKey);

    const result = verifyCashfreeWebhookSignature(
      { signature, timestamp },
      rawBody,
      secretKey,
      baseNow
    );

    assert.equal(result.valid, false);
    assert.equal(result.reason, "TIMESTAMP_OUT_OF_BOUNDS");
  });

  it("rejects future timestamp more than 5 minutes ahead", () => {
    // 6 minutes in the future
    const futureTime = new Date(baseNow.getTime() + 360 * 1000);
    const timestamp = futureTime.toISOString();
    const signature = computeCashfreeSignature(timestamp, rawBody, secretKey);

    const result = verifyCashfreeWebhookSignature(
      { signature, timestamp },
      rawBody,
      secretKey,
      baseNow
    );

    assert.equal(result.valid, false);
    assert.equal(result.reason, "TIMESTAMP_OUT_OF_BOUNDS");
  });

  it("rejects missing headers", () => {
    const res1 = verifyCashfreeWebhookSignature(
      { signature: null, timestamp: "12345" },
      rawBody,
      secretKey,
      baseNow
    );
    assert.equal(res1.valid, false);
    assert.equal(res1.reason, "MISSING_HEADERS");

    const res2 = verifyCashfreeWebhookSignature(
      { signature: "abc", timestamp: null },
      rawBody,
      secretKey,
      baseNow
    );
    assert.equal(res2.valid, false);
    assert.equal(res2.reason, "MISSING_HEADERS");
  });
});
