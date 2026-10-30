import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PaymentStatus } from "../src/generated/prisma/enums";
import { deriveWebhookDedupeKey } from "../src/lib/payments/types";
import { CashfreeProvider } from "../src/lib/payments/cashfree/provider";

/**
 * Validates permitted status transitions for payment records.
 */
function isValidPaymentTransition(current: PaymentStatus, target: PaymentStatus, isSameOrderRetry = false): boolean {
  if (current === target) return true;

  switch (current) {
    case PaymentStatus.CREATED:
      return ([
        PaymentStatus.PENDING,
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.ABANDONED,
        PaymentStatus.EXPIRED,
      ] as PaymentStatus[]).includes(target);

    case PaymentStatus.PENDING:
      return ([
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.ABANDONED,
        PaymentStatus.EXPIRED,
      ] as PaymentStatus[]).includes(target);

    case PaymentStatus.FAILED:
    case PaymentStatus.ABANDONED:
      // FAILED/ABANDONED -> PAID is allowed ONLY if provider reports later success on same order
      if (target === PaymentStatus.PAID && isSameOrderRetry) {
        return true;
      }
      return ([PaymentStatus.EXPIRED] as PaymentStatus[]).includes(target);

    case PaymentStatus.PAID:
      // PAID is strictly terminal for payment status (refunds are tracked separately in refunds table)
      return false;

    case PaymentStatus.EXPIRED:
      return false;

    default:
      return false;
  }
}

describe("Payment State Machine & Deduplication", () => {
  it("permits standard valid forward transitions", () => {
    assert.equal(isValidPaymentTransition(PaymentStatus.CREATED, PaymentStatus.PENDING), true);
    assert.equal(isValidPaymentTransition(PaymentStatus.CREATED, PaymentStatus.PAID), true);
    assert.equal(isValidPaymentTransition(PaymentStatus.PENDING, PaymentStatus.PAID), true);
    assert.equal(isValidPaymentTransition(PaymentStatus.PENDING, PaymentStatus.FAILED), true);
    assert.equal(isValidPaymentTransition(PaymentStatus.PENDING, PaymentStatus.EXPIRED), true);
  });

  it("permits FAILED or ABANDONED to transition to PAID only on same-order customer retry", () => {
    assert.equal(isValidPaymentTransition(PaymentStatus.FAILED, PaymentStatus.PAID, true), true);
    assert.equal(isValidPaymentTransition(PaymentStatus.ABANDONED, PaymentStatus.PAID, true), true);
    assert.equal(isValidPaymentTransition(PaymentStatus.FAILED, PaymentStatus.PAID, false), false);
  });

  it("treats PAID as terminal for payment status", () => {
    assert.equal(isValidPaymentTransition(PaymentStatus.PAID, PaymentStatus.FAILED), false);
    assert.equal(isValidPaymentTransition(PaymentStatus.PAID, PaymentStatus.PENDING), false);
    assert.equal(isValidPaymentTransition(PaymentStatus.PAID, PaymentStatus.EXPIRED), false);
  });

  it("derives deterministic dedupe keys for webhooks", () => {
    const key1 = deriveWebhookDedupeKey("cashfree", "PAYMENT_SUCCESS_WEBHOOK", "order_1", "pay_99", "SUCCESS");
    const key2 = deriveWebhookDedupeKey("CASHFREE", "PAYMENT_SUCCESS_WEBHOOK", "order_1", "pay_99", "SUCCESS");
    const keyDiff = deriveWebhookDedupeKey("cashfree", "PAYMENT_FAILED_WEBHOOK", "order_1", "pay_99", "FAILED");

    assert.equal(key1, "cashfree:PAYMENT_SUCCESS_WEBHOOK:order_1:pay_99:SUCCESS");
    assert.equal(key1, key2);
    assert.notEqual(key1, keyDiff);
  });

  it("CashfreeProvider parses unknown/unhandled events as IGNORED without throwing (Amendment 10)", () => {
    const provider = new CashfreeProvider({ clientId: "dummy", clientSecret: "dummy" });

    const incidentPayload = JSON.stringify({
      type: "INCIDENT_WEBHOOK",
      data: { message: "Bank outage" },
    });
    const parsed1 = provider.parseWebhook(incidentPayload);
    assert.equal(parsed1.type, "IGNORED");
    assert.equal(parsed1.status, "IGNORED");

    const tdrPayload = JSON.stringify({
      type: "SUCCESS_PAYMENT_TDR_WEBHOOK",
      data: { order: { order_id: "order_123" } },
    });
    const parsed2 = provider.parseWebhook(tdrPayload);
    assert.equal(parsed2.type, "IGNORED");
  });

  it("CashfreeProvider parses auto-refund for unknown refund id without throwing (Amendment 10)", () => {
    const provider = new CashfreeProvider({ clientId: "dummy", clientSecret: "dummy" });

    const autoRefundPayload = JSON.stringify({
      type: "AUTO_REFUND_STATUS_WEBHOOK",
      data: {
        refund: {
          cf_refund_id: "cf_auto_9988",
          order_id: "order_123",
          refund_amount: 500,
          refund_status: "SUCCESS",
          status_description: "Auto refund due to timeout",
        },
      },
    });

    const parsed = provider.parseWebhook(autoRefundPayload);
    assert.equal(parsed.type, "AUTO_REFUND_STATUS");
    assert.equal(parsed.cfRefundId, "cf_auto_9988");
    assert.equal(parsed.amount, 500);
    assert.equal(parsed.status, "SUCCESS");
  });
});

describe("Cashfree Order Expiry & Late-Payment Gap", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { computeCashfreeOrderExpiry } = require("../src/lib/payments/types");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { HOLD_MINUTES, CASHFREE_MIN_EXPIRY_MINUTES, CASHFREE_EXPIRY_SAFETY_MINUTES } = require("../src/lib/constants");

  it("constants enforce HOLD_MINUTES = 20, CASHFREE_MIN = 15, SAFETY = 3", () => {
    assert.equal(HOLD_MINUTES, 20);
    assert.equal(CASHFREE_MIN_EXPIRY_MINUTES, 15);
    assert.equal(CASHFREE_EXPIRY_SAFETY_MINUTES, 3);
  });

  it("for hold created at T, createOrder called up to 60s later has order_expiry_time >= 18m from createOrder call", () => {
    const T = new Date("2026-10-30T10:00:00.000Z");
    const holdExpiresAt = new Date(T.getTime() + HOLD_MINUTES * 60 * 1000); // 10:20:00

    // Test across delays from 0 to 60 seconds
    const delaysSeconds = [0, 5, 15, 30, 45, 60];
    for (const sec of delaysSeconds) {
      const callTime = new Date(T.getTime() + sec * 1000);
      const orderExpiry = computeCashfreeOrderExpiry(holdExpiresAt, callTime);

      const diffMs = orderExpiry.getTime() - callTime.getTime();
      const diffMinutes = diffMs / (60 * 1000);

      // Must be at least 18 minutes after the createOrder call
      assert.ok(
        diffMinutes >= 18,
        `Expected diffMinutes (${diffMinutes}) >= 18 for delay ${sec}s`
      );

      // Must format cleanly as ISO 8601 UTC
      const iso = orderExpiry.toISOString();
      assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("handles resume flow when createOrder is called late in hold (order expiry extends past holdExpiresAt)", () => {
    const T = new Date("2026-10-30T10:00:00.000Z");
    const holdExpiresAt = new Date(T.getTime() + HOLD_MINUTES * 60 * 1000); // 10:20:00

    // Patient resumes checkout at T + 15 minutes (only 5 minutes remaining on hold)
    const resumeCallTime = new Date(T.getTime() + 15 * 60 * 1000); // 10:15:00
    const orderExpiry = computeCashfreeOrderExpiry(holdExpiresAt, resumeCallTime);

    // Gateway requires at least 18 minutes from createOrder: 10:15 + 18m = 10:33:00
    const diffMs = orderExpiry.getTime() - resumeCallTime.getTime();
    const diffMinutes = diffMs / (60 * 1000);
    assert.equal(diffMinutes, 18);
    assert.ok(orderExpiry.getTime() > holdExpiresAt.getTime());
  });

  it("evaluates late payment gap recovery: reclaims slot if free, refunds 100% if slot lost", () => {
    // Pure specification of the late-payment decision logic executed in handlePaymentSuccess
    type LatePaymentDecision =
      | { action: "RECLAIM_AND_CONFIRM" }
      | { action: "REFUND_100"; reason: string; needsAttention: boolean };

    function resolveLatePaymentArrival(params: {
      slotStatus: "AVAILABLE" | "BOOKED" | "BLOCKED";
      slotStartTime: Date;
      now: Date;
    }): LatePaymentDecision {
      const cutoff = new Date(params.now.getTime() + 30 * 60 * 1000);
      if (params.slotStatus === "AVAILABLE" && params.slotStartTime > cutoff) {
        return { action: "RECLAIM_AND_CONFIRM" };
      }
      return {
        action: "REFUND_100",
        reason: "Slot was booked by another patient before late payment arrived. 100% refund initiated.",
        needsAttention: true,
      };
    }

    const now = new Date("2026-10-30T10:30:00.000Z");

    // Case 1: Slot is free and > 30 min away -> Reclaimed
    const freeSlotStart = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours away
    const resFree = resolveLatePaymentArrival({
      slotStatus: "AVAILABLE",
      slotStartTime: freeSlotStart,
      now,
    });
    assert.equal(resFree.action, "RECLAIM_AND_CONFIRM");

    // Case 2: Slot was taken by another patient while hold expired -> 100% refund with needsAttention
    const resTaken = resolveLatePaymentArrival({
      slotStatus: "BOOKED",
      slotStartTime: freeSlotStart,
      now,
    });
    assert.equal(resTaken.action, "REFUND_100");
    assert.equal(resTaken.needsAttention, true);

    // Case 3: Slot is AVAILABLE but < 30m away (past booking cutoff) -> 100% refund
    const tooCloseSlotStart = new Date(now.getTime() + 20 * 60 * 1000); // 20 mins away
    const resClose = resolveLatePaymentArrival({
      slotStatus: "AVAILABLE",
      slotStartTime: tooCloseSlotStart,
      now,
    });
    assert.equal(resClose.action, "REFUND_100");
    assert.equal(resClose.needsAttention, true);
  });
});

