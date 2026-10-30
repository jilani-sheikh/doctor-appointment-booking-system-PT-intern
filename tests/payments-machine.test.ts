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
