import test from "node:test";
import assert from "node:assert/strict";
import { toWhatsAppE164 } from "../src/lib/notifications/whatsapp/channel";
import { classifyWhatsAppError } from "../src/lib/notifications/whatsapp/errors";
import { renderWhatsAppMessage } from "../src/lib/notifications/whatsapp/messages";

const slot = { startTime: new Date("2026-10-30T04:30:00.000Z"), endTime: new Date("2026-10-30T05:00:00.000Z") };

test("normalizes Indian numbers to E.164", () => {
  assert.equal(toWhatsAppE164("09876543210"), "+919876543210");
  assert.equal(toWhatsAppE164("12345"), null);
});

test("renders every patient message with safe content", () => {
  const messages = [
    renderWhatsAppMessage("appointment_confirmed", { doctorName: "A", ...slot }),
    renderWhatsAppMessage("appointment_cancelled", { doctorName: "A", ...slot, cancelledBy: "DOCTOR", refundInitiated: true }),
    renderWhatsAppMessage("appointment_rescheduled", { doctorName: "A", oldStartTime: slot.startTime, oldEndTime: slot.endTime, newStartTime: slot.startTime, newEndTime: slot.endTime }),
    renderWhatsAppMessage("arrival_window", { ...slot, arrivalStartTime: slot.startTime, arrivalEndTime: slot.endTime }),
    renderWhatsAppMessage("appointment_reminder", { doctorName: "A", ...slot }),
    renderWhatsAppMessage("payment_receipt", { amountRupees: 500, providerOrderId: "order_demo" }),
    renderWhatsAppMessage("refund_update", { status: "PENDING" }),
  ];
  for (const message of messages) {
    assert.match(message, /^Medrella:/);
    assert.doesNotMatch(message, /diagnos|symptom|reason|medical details/i);
  }
  assert.match(messages[1], /A refund has been initiated/);
  assert.match(messages[6], /pending/i);
});

test("maps retryable and non-retryable Twilio errors", () => {
  assert.equal(classifyWhatsAppError(400, 63015).classification, "non_retryable");
  assert.equal(classifyWhatsAppError(400, 63016).reason, "outside the 24-hour window; recipient must message the sandbox number first");
  assert.equal(classifyWhatsAppError(400, 20429).classification, "retryable");
  assert.equal(classifyWhatsAppError(503).classification, "retryable");
});

test("disabled mode requires no provider call", async () => {
  process.env.WHATSAPP_MODE = "disabled";
  const { sendWhatsAppMessage } = await import("../src/lib/notifications/whatsapp/channel");
  const result = await sendWhatsAppMessage("appointment_reminder", { ...slot }, "9876543210");
  assert.equal(result.success, true);
});
