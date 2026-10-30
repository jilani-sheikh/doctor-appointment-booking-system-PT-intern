import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateRefundPolicy } from "../src/lib/refund-policy";
import { RefundReason } from "../src/generated/prisma/enums";

describe("Refund Policy & Paise Arithmetic", () => {
  const baseTime = new Date("2026-11-01T12:00:00Z");

  it("gives 100% refund when patient cancels >= 24 hours in advance", () => {
    const slotStart = new Date(baseTime.getTime() + 25 * 60 * 60 * 1000); // 25h ahead
    const res = calculateRefundPolicy({
      paidAmountPaise: 100000, // ₹1,000.00
      reason: RefundReason.PATIENT_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
    });

    assert.equal(res.percent, 100);
    assert.equal(res.amountPaise, 100000);
    assert.equal(res.amountRupees, 1000);
  });

  it("gives 100% refund at exactly 24 hours boundary", () => {
    const slotStart = new Date(baseTime.getTime() + 24 * 60 * 60 * 1000); // Exactly 24h
    const res = calculateRefundPolicy({
      paidAmountPaise: 100000,
      reason: RefundReason.PATIENT_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
    });

    assert.equal(res.percent, 100);
    assert.equal(res.amountPaise, 100000);
  });

  it("gives 50% refund between 2 hours and 24 hours before slot", () => {
    const slotStart = new Date(baseTime.getTime() + 5 * 60 * 60 * 1000); // 5h ahead
    const res = calculateRefundPolicy({
      paidAmountPaise: 150000, // ₹1,500.00
      reason: RefundReason.PATIENT_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
    });

    assert.equal(res.percent, 50);
    assert.equal(res.amountPaise, 75000);
    assert.equal(res.amountRupees, 750);
  });

  it("gives 50% refund at exactly 2 hours boundary", () => {
    const slotStart = new Date(baseTime.getTime() + 2 * 60 * 60 * 1000); // Exactly 2h
    const res = calculateRefundPolicy({
      paidAmountPaise: 80000,
      reason: RefundReason.PATIENT_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
    });

    assert.equal(res.percent, 50);
    assert.equal(res.amountPaise, 40000);
    assert.equal(res.amountRupees, 400);
  });

  it("gives 0% refund within 2 hours of slot start", () => {
    const slotStart = new Date(baseTime.getTime() + 1 * 60 * 60 * 1000); // 1h ahead
    const res = calculateRefundPolicy({
      paidAmountPaise: 100000,
      reason: RefundReason.PATIENT_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
    });

    assert.equal(res.percent, 0);
    assert.equal(res.amountPaise, 0);
    assert.equal(res.amountRupees, 0);
  });

  it("gives 100% refund for doctor cancellations regardless of timing", () => {
    const slotStart = new Date(baseTime.getTime() + 30 * 60 * 1000); // 30m ahead
    const res = calculateRefundPolicy({
      paidAmountPaise: 50000,
      reason: RefundReason.DOCTOR_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
    });

    assert.equal(res.percent, 100);
    assert.equal(res.amountPaise, 50000);
  });

  it("gives 100% refund for doctor absence disruptions regardless of timing", () => {
    const slotStart = new Date(baseTime.getTime() + 10 * 60 * 1000);
    const res = calculateRefundPolicy({
      paidAmountPaise: 50000,
      reason: RefundReason.PATIENT_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
      isDisrupted: true,
    });

    assert.equal(res.percent, 100);
    assert.equal(res.amountPaise, 50000);
  });

  it("gives 100% refund when slot is lost after late payment", () => {
    const slotStart = new Date(baseTime.getTime() + 10 * 60 * 1000);
    const res = calculateRefundPolicy({
      paidAmountPaise: 75000,
      reason: RefundReason.SLOT_LOST_AFTER_PAYMENT,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
    });

    assert.equal(res.percent, 100);
    assert.equal(res.amountPaise, 75000);
  });

  it("enforces partial refund cap: total non-failed refunds cannot exceed paid amount", () => {
    // Paid ₹1,000 (100,000 paise). Already refunded ₹700 (70,000 paise).
    // Now requesting 50% (50,000 paise). But remaining refundable is only 30,000 paise.
    const slotStart = new Date(baseTime.getTime() + 10 * 60 * 60 * 1000);
    const res = calculateRefundPolicy({
      paidAmountPaise: 100000,
      reason: RefundReason.PATIENT_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
      priorNonFailedRefundsPaise: 70000,
    });

    assert.equal(res.percent, 50);
    assert.equal(res.amountPaise, 30000); // Capped at remaining 30,000 paise
    assert.equal(res.amountRupees, 300);
  });

  it("handles odd paise rounding cleanly without fractional paise", () => {
    // ₹999.00 = 99900 paise. 50% = 49950 paise.
    const slotStart = new Date(baseTime.getTime() + 5 * 60 * 60 * 1000);
    const res = calculateRefundPolicy({
      paidAmountPaise: 99900,
      reason: RefundReason.PATIENT_CANCELLED,
      slotStartTime: slotStart,
      cancelledAt: baseTime,
    });

    assert.equal(Number.isInteger(res.amountPaise), true);
    assert.equal(res.amountPaise, 49950);
    assert.equal(res.amountRupees, 499.5);
  });
});
