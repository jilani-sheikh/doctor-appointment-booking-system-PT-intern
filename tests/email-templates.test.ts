import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  renderBookingConfirmedEmail,
  renderPaymentReceiptEmail,
  renderAppointmentCancelledEmail,
  renderAppointmentRescheduledEmail,
  renderRefundStatusEmail,
  renderAppointmentReminderEmail,
} from "../src/lib/email/templates/index";

describe("Email Templates & Escaping", () => {
  const baseTime = new Date("2026-11-05T09:30:00Z");

  it("escapes malicious HTML injection in user names and input", () => {
    const maliciousName = "<script>alert('xss')</script> & Co.";
    const escaped = escapeHtml(maliciousName);

    assert.equal(escaped.includes("<script>"), false);
    assert.equal(escaped.includes("&lt;script&gt;"), true);
    assert.equal(escaped.includes("&amp;"), true);
  });

  it("renders booking confirmation email with IST timestamp and plain-text fallback", () => {
    const res = renderBookingConfirmedEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      specialization: "General Medicine",
      startTime: baseTime,
      arrivalWindow: "02:45 PM – 03:30 PM",
    });

    assert.equal(res.html.includes("Jane Doe"), true);
    assert.equal(res.html.includes("Dr. Smith"), true);
    assert.equal(res.html.includes("IST"), true);
    assert.equal(res.html.includes("02:45 PM – 03:30 PM"), true);
    assert.equal(res.text.includes("Jane Doe"), true);
    assert.equal(res.text.includes("IST"), true);
  });

  it("renders payment receipt with formatted INR currency and reference IDs", () => {
    const res = renderPaymentReceiptEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      amountRupees: 750,
      providerOrderId: "order_xyz_123",
      providerPaymentId: "cf_pay_999",
      paidAt: baseTime,
      paymentId: "cuid_payment_1",
    });

    assert.equal(res.html.includes("₹750"), true);
    assert.equal(res.html.includes("order_xyz_123"), true);
    assert.equal(res.html.includes("cf_pay_999"), true);
    assert.equal(res.html.includes("cuid_payment_1"), true);
  });

  it("renders cancellation email with refund notice and truthful status", () => {
    const res = renderAppointmentCancelledEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      startTime: baseTime,
      cancelledBy: "PATIENT",
      refundSummary: "A 50% refund (₹375) has been initiated to your original payment method.",
    });

    assert.equal(res.html.includes("cancelled (PATIENT)"), true);
    assert.equal(res.html.includes("A 50% refund (₹375) has been initiated"), true);
  });

  it("renders refund status update truthfully (Initiated vs Processed vs Failed)", () => {
    const initiated = renderRefundStatusEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      amountRupees: 500,
      status: "PENDING",
      providerRefundId: "ref_123",
    });
    assert.equal(initiated.html.includes("Refund Initiated"), true);
    assert.equal(initiated.html.includes("ref_123"), true);

    const success = renderRefundStatusEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      amountRupees: 500,
      status: "SUCCESS",
      providerRefundId: "ref_123",
    });
    assert.equal(success.html.includes("Refund Processed Successfully"), true);

    const failed = renderRefundStatusEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      amountRupees: 500,
      status: "FAILED",
      providerRefundId: "ref_123",
      failureReason: "Bank network unavailable",
    });
    assert.equal(failed.html.includes("Refund Processing Failed"), true);
    assert.equal(failed.html.includes("Bank network unavailable"), true);
  });

  it("renders appointment reminder email with relative timeline", () => {
    const res = renderAppointmentReminderEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      startTime: baseTime,
      offsetMinutes: 120, // 2 hours
    });

    assert.equal(res.html.includes("in 2 hour(s)"), true);
    assert.equal(res.html.includes("IST"), true);
  });

  it("renders appointment rescheduled email", () => {
    const res = renderAppointmentRescheduledEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      oldStartTime: baseTime,
      newStartTime: new Date("2026-11-06T10:00:00Z"),
    });

    assert.equal(res.html.includes("Rescheduled"), true);
    assert.equal(res.html.includes("Jane Doe"), true);
  });

  it("renders slot time ranges when endTime is provided", () => {
    // 03:00 PM to 03:30 PM IST (baseTime is 09:30 UTC -> 15:00 IST)
    const endTime = new Date("2026-11-05T10:00:00Z"); // 15:30 IST

    const confirmed = renderBookingConfirmedEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      specialization: "General Medicine",
      startTime: baseTime,
      endTime,
      arrivalWindow: "02:45 PM – 03:30 PM",
    });
    assert.equal(confirmed.html.includes("03:00 pm - 03:30 pm"), true);
    assert.equal(confirmed.text.includes("03:00 pm - 03:30 pm"), true);

    const cancelled = renderAppointmentCancelledEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      startTime: baseTime,
      endTime,
      cancelledBy: "DOCTOR",
    });
    assert.equal(cancelled.html.includes("03:00 pm - 03:30 pm"), true);

    const rescheduled = renderAppointmentRescheduledEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      oldStartTime: baseTime,
      oldEndTime: endTime,
      newStartTime: new Date("2026-11-06T04:30:00Z"), // 10:00 AM IST
      newEndTime: new Date("2026-11-06T05:00:00Z"),   // 10:30 AM IST
    });
    assert.equal(rescheduled.html.includes("03:00 pm - 03:30 pm"), true);
    assert.equal(rescheduled.html.includes("10:00 am - 10:30 am"), true);

    const reminder = renderAppointmentReminderEmail({
      patientName: "Jane Doe",
      doctorName: "Smith",
      startTime: baseTime,
      endTime,
      offsetMinutes: 60,
    });
    assert.equal(reminder.html.includes("03:00 pm - 03:30 pm"), true);
  });
});
