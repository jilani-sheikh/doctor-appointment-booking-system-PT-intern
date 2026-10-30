/**
 * Medrella End-to-End Payments, Refunds, and Notifications Verification Script.
 *
 * Runs 12 integration scenarios against the live database using FakePaymentProvider:
 * 1. Two concurrent holds on one slot -> exactly one succeeds, one fails.
 * 2. Webhook idempotency: duplicate success webhook calls -> exactly 1 CONFIRMED appt, 1 notification, 1 receipt email.
 * 3. Failed then retried success on same order -> transitions to PAID and CONFIRMED.
 * 4. Hold expiry releases slot -> expireStaleHolds marks hold CANCELLED and frees slot.
 * 5. Late success after expiry:
 *    - 5A: Slot still free -> re-claims slot and confirms.
 *    - 5B: Slot already taken -> full auto-refund, marks CANCELLED, flags needsAttention.
 * 6. Cancel twice idempotency -> duplicate cancel produces exactly ONE refund row.
 * 7. Partial refund cap -> cannot refund more than total paid amount.
 * 8. Notification reminder sync -> cancel cancels reminders; reschedule recreates reminders for new time.
 * 9. Webhook signature & replay protection -> rejected on tampered signature or stale timestamp.
 * 10. Auto-refund event for unknown refund id recorded/ignored without throwing.
 * 11. Unknown and ignored webhook event types return IGNORED without throwing.
 * 12. Paise arithmetic and currency precision.
 *
 * Run with: npx tsx scripts/test-payments.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

// Shim server-only for standalone Node/tsx script execution
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as unknown as NodeJS.Module;
} catch {
  // Ignore if server-only is not present
}

import assert from "node:assert";
import { PrismaClient, DoctorStatus, SlotStatus, AppointmentStatus, PaymentStatus, RefundReason, DeliveryStatus, VisitStream } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

import { FakePaymentProvider } from "../src/lib/payments/fake/provider";
import { setPaymentProviderOverride } from "../src/lib/payments/factory";
import {
  bookWithPaymentHold,
  handlePaymentSuccess,
  handlePaymentFailed,
  expireStaleHolds,
  requestRefund,
} from "../src/lib/payments/service";
import { syncAppointmentReminders } from "../src/lib/notifications/reminders";
import { rupeesToPaise, paiseToRupees, formatINR } from "../src/lib/money";
import { verifyCashfreeWebhookSignature, computeCashfreeSignature } from "../src/lib/payments/cashfree/signature";
import { CashfreeProvider } from "../src/lib/payments/cashfree/provider";
import { calculateRefundPolicy } from "../src/lib/refund-policy";

async function main() {
  console.log("=================================================================");
  console.log("       MEDRELLA PAYMENTS & NOTIFICATIONS INTEGRATION TEST SUITE  ");
  console.log("=================================================================\n");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    console.log("⚠️ DATABASE_URL is not configured. Marking live DB payment suite as UNTESTED.");
    process.exit(0);
  }

  // Set PAYMENTS_MODE to "cashfree" for testing the payment path
  process.env.PAYMENTS_MODE = "cashfree";

  const fakeProvider = new FakePaymentProvider();
  setPaymentProviderOverride(fakeProvider);

  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  const testSuffix = Date.now().toString().slice(-6);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doctorUser: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doctor: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let patientUser1: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let patient1: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let patientUser2: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let patient2: any = null;

  try {
    console.log("1. Setting up test fixtures (Doctor and 2 Patients)...");
    doctorUser = await db.user.create({
      data: {
        name: `Dr. Payments Test ${testSuffix}`,
        email: `doc.pay.${testSuffix}@medrella.test`,
        role: "DOCTOR",
      },
    });

    doctor = await db.doctor.create({
      data: {
        userId: doctorUser.id,
        specialization: "Cardiology",
        qualification: "MBBS, MD",
        experienceYears: 10,
        consultationFee: 500, // Rs. 500
        status: DoctorStatus.APPROVED,
      },
    });

    patientUser1 = await db.user.create({
      data: {
        name: `Patient One ${testSuffix}`,
        email: `p1.${testSuffix}@medrella.test`,
        role: "PATIENT",
      },
    });
    patient1 = await db.patient.create({
      data: {
        userId: patientUser1.id,
        gender: "MALE",
        phone: "+91 9876543210",
        dateOfBirth: new Date("1990-01-01"),
      },
    });

    patientUser2 = await db.user.create({
      data: {
        name: `Patient Two ${testSuffix}`,
        email: `p2.${testSuffix}@medrella.test`,
        role: "PATIENT",
      },
    });
    patient2 = await db.patient.create({
      data: {
        userId: patientUser2.id,
        gender: "FEMALE",
        phone: "+91 9123456789",
        dateOfBirth: new Date("1992-05-15"),
      },
    });

    console.log("✓ Fixtures ready.\n");

    // =========================================================================
    // SCENARIO 1: Two concurrent holds on one slot -> exactly one succeeds
    // =========================================================================
    console.log("--- SCENARIO 1: Two Concurrent Holds on One Slot ---");
    const slot1Start = new Date(Date.now() + 48 * 3600 * 1000);
    const slot1End = new Date(slot1Start.getTime() + 15 * 60 * 1000);
    const slot1 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: slot1Start,
        endTime: slot1End,
        status: SlotStatus.AVAILABLE,
      },
    });

    const [holdResult1, holdResult2] = await Promise.all([
      bookWithPaymentHold({
        patientId: patient1.id,
        userId: patientUser1.id,
        patientName: patientUser1.name,
        patientEmail: patientUser1.email,
        patientPhone: patient1.phone,
        availabilityId: slot1.id,
        stream: VisitStream.NEW_CONSULTATION,
      }),
      bookWithPaymentHold({
        patientId: patient2.id,
        userId: patientUser2.id,
        patientName: patientUser2.name,
        patientEmail: patientUser2.email,
        patientPhone: patient2.phone,
        availabilityId: slot1.id,
        stream: VisitStream.NEW_CONSULTATION,
      }),
    ]);

    const successes = [holdResult1, holdResult2].filter((r) => r.success);
    const failures = [holdResult1, holdResult2].filter((r) => !r.success);

    assert.strictEqual(successes.length, 1, "Exactly one concurrent hold should succeed");
    assert.strictEqual(failures.length, 1, "Exactly one concurrent hold should fail");
    console.log("✓ Exactly one hold succeeded, one failed with:", failures[0].error);

    const winningOrderId = successes[0].orderId!;
    const winningApptId = successes[0].appointmentId!;

    // =========================================================================
    // SCENARIO 2: Simulate success webhook twice -> exactly 1 CONFIRMED appt, 1 notification, 1 receipt email
    // =========================================================================
    console.log("\n--- SCENARIO 2: Webhook Idempotency (Duplicate Success Events) ---");
    const firstWebhook = await handlePaymentSuccess(winningOrderId, "cf_pay_1", 500, "UPI");
    const secondWebhook = await handlePaymentSuccess(winningOrderId, "cf_pay_1", 500, "UPI");

    assert.strictEqual(firstWebhook, true, "First webhook handling should return true");
    assert.strictEqual(secondWebhook, true, "Duplicate webhook handling should return true (idempotent)");

    const apptAfterSuccess = await db.appointment.findUnique({
      where: { id: winningApptId },
      include: { payments: true },
    });

    assert.strictEqual(apptAfterSuccess?.status, AppointmentStatus.CONFIRMED, "Appointment must be CONFIRMED");
    assert.strictEqual(apptAfterSuccess?.payments[0]?.status, PaymentStatus.PAID, "Payment must be PAID");

    const receiptEmails = await db.notificationDelivery.findMany({
      where: {
        appointmentId: winningApptId,
        template: "payment_receipt",
      },
    });
    assert.strictEqual(receiptEmails.length, 1, "Exactly ONE payment receipt email should be queued");

    const inAppNotifs = await db.notification.findMany({
      where: {
        userId: patientUser1.id,
        type: "APPOINTMENT_CONFIRMED",
      },
    });
    assert.strictEqual(inAppNotifs.length, 1, "Exactly ONE in-app notification should be created");
    console.log("✓ Webhook idempotency verified: 1 CONFIRMED appt, 1 payment receipt email, 1 in-app notif");

    // =========================================================================
    // SCENARIO 3: Failed then retried success on same order
    // =========================================================================
    console.log("\n--- SCENARIO 3: Failed then Retried Success on Same Order ---");
    const slot2Start = new Date(Date.now() + 50 * 3600 * 1000);
    const slot2End = new Date(slot2Start.getTime() + 15 * 60 * 1000);
    const slot2 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: slot2Start,
        endTime: slot2End,
        status: SlotStatus.AVAILABLE,
      },
    });

    const holdRetry = await bookWithPaymentHold({
      patientId: patient1.id,
      userId: patientUser1.id,
      patientName: patientUser1.name,
      patientEmail: patientUser1.email,
      patientPhone: patient1.phone,
      availabilityId: slot2.id,
      stream: VisitStream.NEW_CONSULTATION,
    });
    assert.ok(holdRetry.success, "Hold creation should succeed");

    // First attempt fails
    await handlePaymentFailed(holdRetry.orderId!, "Bank server timeout");
    let paymentRec = await db.payment.findUnique({ where: { providerOrderId: holdRetry.orderId! } });
    assert.strictEqual(paymentRec?.status, PaymentStatus.FAILED, "Payment should be FAILED");

    // Patient retries with same order session and succeeds
    await handlePaymentSuccess(holdRetry.orderId!, "cf_pay_retry_1", 500, "CARD");
    paymentRec = await db.payment.findUnique({ where: { providerOrderId: holdRetry.orderId! } });
    assert.strictEqual(paymentRec?.status, PaymentStatus.PAID, "Payment should now be PAID");
    const apptRetry = await db.appointment.findUnique({ where: { id: holdRetry.appointmentId! } });
    assert.strictEqual(apptRetry?.status, AppointmentStatus.CONFIRMED, "Appointment should now be CONFIRMED");
    console.log("✓ Failed payment successfully recovered on retry");

    // =========================================================================
    // SCENARIO 4: Hold expiry releases slot
    // =========================================================================
    console.log("\n--- SCENARIO 4: Hold Expiry Releases Slot ---");
    const slot3Start = new Date(Date.now() + 52 * 3600 * 1000);
    const slot3End = new Date(slot3Start.getTime() + 15 * 60 * 1000);
    const slot3 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: slot3Start,
        endTime: slot3End,
        status: SlotStatus.AVAILABLE,
      },
    });

    const holdExpired = await bookWithPaymentHold({
      patientId: patient2.id,
      userId: patientUser2.id,
      patientName: patientUser2.name,
      patientEmail: patientUser2.email,
      patientPhone: patient2.phone,
      availabilityId: slot3.id,
      stream: VisitStream.NEW_CONSULTATION,
    });

    // Manually push expiresAt into the past
    await db.appointment.update({
      where: { id: holdExpired.appointmentId! },
      data: { holdExpiresAt: new Date(Date.now() - 60000) },
    });
    await db.payment.update({
      where: { providerOrderId: holdExpired.orderId! },
      data: { expiresAt: new Date(Date.now() - 60000) },
    });

    // Run hold expiry
    const holdExpiryResult = await expireStaleHolds();
    assert.ok(holdExpiryResult.expiredCount >= 1, "At least 1 stale hold should be expired");

    const slotAfterExpiry = await db.availability.findUnique({ where: { id: slot3.id } });
    const apptAfterExpiry = await db.appointment.findUnique({ where: { id: holdExpired.appointmentId! } });
    assert.strictEqual(slotAfterExpiry?.status, SlotStatus.AVAILABLE, "Slot should be released back to AVAILABLE");
    assert.strictEqual(apptAfterExpiry?.status, AppointmentStatus.CANCELLED, "Expired hold appointment should be CANCELLED");
    console.log("✓ Hold expiry released slot and cancelled appointment cleanly");

    // =========================================================================
    // SCENARIO 5: Late success after expiry
    // 5A: Slot is still free -> re-claims slot, confirms appointment
    // 5B: Slot is taken -> issues full refund, cancels, flags needsAttention
    // =========================================================================
    console.log("\n--- SCENARIO 5A: Late Success with Slot Still Available ---");
    // Patient paid right at expiry boundary and webhook arrived late. Slot 3 is still AVAILABLE.
    await handlePaymentSuccess(holdExpired.orderId!, "cf_late_pay", 500, "UPI");
    const apptLateReclaimed = await db.appointment.findUnique({ where: { id: holdExpired.appointmentId! } });
    const slotLateReclaimed = await db.availability.findUnique({ where: { id: slot3.id } });
    assert.strictEqual(apptLateReclaimed?.status, AppointmentStatus.CONFIRMED, "Appt should be reclaimed to CONFIRMED");
    assert.strictEqual(slotLateReclaimed?.status, SlotStatus.BOOKED, "Slot should be re-booked");
    console.log("✓ Late payment re-claimed available slot successfully");

    console.log("\n--- SCENARIO 5B: Late Success with Slot Taken by Another Patient ---");
    // Create new slot, create hold, expire it, then another patient books the slot!
    const slot4Start = new Date(Date.now() + 54 * 3600 * 1000);
    const slot4End = new Date(slot4Start.getTime() + 15 * 60 * 1000);
    const slot4 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: slot4Start,
        endTime: slot4End,
        status: SlotStatus.AVAILABLE,
      },
    });

    const holdP1 = await bookWithPaymentHold({
      patientId: patient1.id,
      userId: patientUser1.id,
      patientName: patientUser1.name,
      patientEmail: patientUser1.email,
      patientPhone: patient1.phone,
      availabilityId: slot4.id,
      stream: VisitStream.NEW_CONSULTATION,
    });

    // Expire P1's hold
    await db.appointment.update({
      where: { id: holdP1.appointmentId! },
      data: { holdExpiresAt: new Date(Date.now() - 60000) },
    });
    await db.payment.update({
      where: { providerOrderId: holdP1.orderId! },
      data: { expiresAt: new Date(Date.now() - 60000) },
    });
    await expireStaleHolds();

    // Now P2 books and confirms that exact same slot!
    const holdP2 = await bookWithPaymentHold({
      patientId: patient2.id,
      userId: patientUser2.id,
      patientName: patientUser2.name,
      patientEmail: patientUser2.email,
      patientPhone: patient2.phone,
      availabilityId: slot4.id,
      stream: VisitStream.NEW_CONSULTATION,
    });
    await handlePaymentSuccess(holdP2.orderId!, "cf_pay_p2", 500, "UPI");

    // Now late payment arrives for P1! But the slot is now BOOKED by P2!
    await handlePaymentSuccess(holdP1.orderId!, "cf_pay_p1_late", 500, "UPI");

    const p1Payment = await db.payment.findUnique({
      where: { providerOrderId: holdP1.orderId! },
      include: { refunds: true },
    });
    assert.strictEqual(p1Payment?.needsAttention, true, "Payment must be flagged needsAttention");
    assert.ok((p1Payment?.refunds.length ?? 0) >= 1, "Auto-refund row must be created");
    assert.strictEqual(Number(p1Payment?.refunds[0]?.amount), 500, "Full 100% refund should be issued");
    console.log("✓ Late payment for taken slot auto-refunded 100% and flagged needsAttention");

    // =========================================================================
    // SCENARIO 6: Cancel twice idempotency -> duplicate cancel produces exactly ONE refund row
    // =========================================================================
    console.log("\n--- SCENARIO 6: Refund Idempotency (Duplicate Cancel Calls) ---");
    // P2 cancels their appointment twice concurrently
    const p2Payment = await db.payment.findUnique({ where: { providerOrderId: holdP2.orderId! } });

    const refundPromises = [
      requestRefund({
        paymentId: p2Payment!.id,
        appointmentId: holdP2.appointmentId!,
        reason: RefundReason.PATIENT_CANCELLED,
        note: "Patient initiated cancellation",
      }),
      requestRefund({
        paymentId: p2Payment!.id,
        appointmentId: holdP2.appointmentId!,
        reason: RefundReason.PATIENT_CANCELLED,
        note: "Patient initiated cancellation",
      }),
    ];

    const refundResults = await Promise.all(refundPromises);
    assert.strictEqual(refundResults[0].success, true, "First refund request should succeed");
    // The second should either return existing refund or handle unique constraint gracefully
    const refundRows = await db.refund.findMany({
      where: {
        paymentId: p2Payment!.id,
        reason: RefundReason.PATIENT_CANCELLED,
      },
    });
    assert.strictEqual(refundRows.length, 1, "Exactly ONE refund row must exist due to unique constraint idempotency");
    console.log("✓ Duplicate cancel calls produced exactly ONE refund row");

    // =========================================================================
    // SCENARIO 7: Partial refund cap enforced
    // =========================================================================
    console.log("\n--- SCENARIO 7: Partial Refund Cap Enforced ---");
    // Winning payment from Scenario 1 has amount 500
    const winningPayment = await db.payment.findUnique({ where: { providerOrderId: winningOrderId } });
    
    // First full refund on winning payment
    const firstRefund = await requestRefund({
      paymentId: winningPayment!.id,
      appointmentId: winningApptId,
      reason: RefundReason.DOCTOR_CANCELLED,
      note: "Doctor cancelled full refund",
    });
    assert.strictEqual(firstRefund.success, true);

    // Second refund attempt on same payment with override exceeding remaining refundable amount
    const overRefundResult = await requestRefund({
      paymentId: winningPayment!.id,
      appointmentId: winningApptId,
      amountPaiseOverride: 60000,
      reason: RefundReason.POLICY_ADJUSTMENT,
      note: "Excess refund attempt",
    });
    assert.strictEqual(overRefundResult.success, false, "Excess refund must fail");
    assert.ok(overRefundResult.error?.includes("fully refunded"), "Error must mention fully refunded");

    // Pure policy partial refund cap test
    const cappedPolicy = calculateRefundPolicy({
      paidAmountPaise: 50000,
      priorNonFailedRefundsPaise: 35000,
      reason: RefundReason.DOCTOR_CANCELLED,
      slotStartTime: new Date(),
    });
    assert.strictEqual(cappedPolicy.amountPaise, 15000, "Should cap remaining refund at 15000 paise (150 INR)");
    console.log("✓ Over-refund and partial refund cap enforced cleanly");

    // =========================================================================
    // SCENARIO 8: Notification reminder sync
    // =========================================================================
    console.log("\n--- SCENARIO 8: Reminder Synchronization on Reschedule and Cancel ---");
    const slot5Start = new Date(Date.now() + 60 * 3600 * 1000);
    const slot5End = new Date(slot5Start.getTime() + 15 * 60 * 1000);
    const slot5 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: slot5Start,
        endTime: slot5End,
        status: SlotStatus.AVAILABLE,
      },
    });

    const reminderAppt = await db.appointment.create({
      data: {
        patientId: patient1.id,
        availabilityId: slot5.id,
        stream: VisitStream.NEW_CONSULTATION,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    // Sync reminders for slot5
    await syncAppointmentReminders(db, {
      appointmentId: reminderAppt.id,
      userId: patientUser1.id,
      slotStartTime: slot5Start,
      status: AppointmentStatus.CONFIRMED,
    });
    const queuedReminders = await db.notificationDelivery.findMany({
      where: { appointmentId: reminderAppt.id, status: DeliveryStatus.PENDING },
    });
    assert.strictEqual(queuedReminders.length, 2, "Should create 2 default reminders (24h and 2h)");

    // Reschedule slot: slot 6 is 80 hours out
    const slot6Start = new Date(Date.now() + 80 * 3600 * 1000);
    await syncAppointmentReminders(db, {
      appointmentId: reminderAppt.id,
      userId: patientUser1.id,
      slotStartTime: slot6Start,
      status: AppointmentStatus.CONFIRMED,
    });
    const rescheduledReminders = await db.notificationDelivery.findMany({
      where: { appointmentId: reminderAppt.id, status: DeliveryStatus.PENDING },
    });
    assert.strictEqual(rescheduledReminders.length, 2, "Reminders should be rescheduled with new timestamps");

    // Cancel appointment: all pending reminders must be CANCELLED
    await syncAppointmentReminders(db, {
      appointmentId: reminderAppt.id,
      userId: patientUser1.id,
      slotStartTime: slot6Start,
      status: AppointmentStatus.CANCELLED,
    });
    const remainingPending = await db.notificationDelivery.findMany({
      where: { appointmentId: reminderAppt.id, status: DeliveryStatus.PENDING },
    });
    assert.strictEqual(remainingPending.length, 0, "Zero pending reminders must remain after appointment cancellation");

    const cancelledReminders = await db.notificationDelivery.findMany({
      where: { appointmentId: reminderAppt.id, status: DeliveryStatus.CANCELLED },
    });
    assert.strictEqual(cancelledReminders.length, 4, "All 4 reminder outbox entries (2 rescheduled + 2 cancelled) must be marked CANCELLED");
    console.log("✓ Reminder synchronization lifecycle verified");

    // =========================================================================
    // SCENARIO 9: Webhook signature & replay protection
    // =========================================================================
    console.log("\n--- SCENARIO 9: Webhook Signature & Replay Protection ---");
    const secret = "test_secret_cashfree_123456";
    const body = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "order_1" } } });
    const nowMs = Date.now();

    // Stale timestamp (10 minutes ago)
    const staleTimestamp = (nowMs - 600 * 1000).toString();
    const staleSignature = computeCashfreeSignature(staleTimestamp, body, secret);
    const staleCheck = verifyCashfreeWebhookSignature(
      { signature: staleSignature, timestamp: staleTimestamp },
      body,
      secret
    );
    assert.strictEqual(staleCheck.valid, false, "Stale timestamp (> 5 min) must be rejected");
    assert.strictEqual(staleCheck.reason, "TIMESTAMP_OUT_OF_BOUNDS");

    // Tampered signature
    const validTimestamp = nowMs.toString();
    const tamperedCheck = verifyCashfreeWebhookSignature(
      { signature: "tampered_signature_xyz", timestamp: validTimestamp },
      body,
      secret
    );
    assert.strictEqual(tamperedCheck.valid, false, "Tampered signature must be rejected");
    assert.strictEqual(tamperedCheck.reason, "INVALID_SIGNATURE");
    console.log("✓ Signature verification and replay window rejected stale and tampered payloads");

    // =========================================================================
    // SCENARIO 10: Auto-refund event for unknown refund id recorded/ignored without throwing
    // =========================================================================
    console.log("\n--- SCENARIO 10: Auto-refund Event for Unknown Refund ID ---");
    const provider = new CashfreeProvider();
    const autoRefundPayload = JSON.stringify({
      type: "PAYMENT_AUTO_REFUND_WEBHOOK",
      data: {
        refund: {
          refund_id: "cf_unknown_refund_9999",
          order_id: "cf_unknown_order_8888",
          refund_amount: 500,
          refund_status: "SUCCESS",
        },
      },
    });

    const parsedAutoRefund = provider.parseWebhook(autoRefundPayload);
    assert.strictEqual(parsedAutoRefund.type, "AUTO_REFUND_STATUS", "Auto refund event parsed into AUTO_REFUND_STATUS");
    assert.strictEqual(parsedAutoRefund.refundId, "cf_unknown_refund_9999");
    console.log("✓ Auto-refund event parsed smoothly without throwing");

    // =========================================================================
    // SCENARIO 11: Unknown and ignored event types return IGNORED with 200 without throwing
    // =========================================================================
    console.log("\n--- SCENARIO 11: Unknown and Ignored Event Types ---");
    const unknownPayload = JSON.stringify({
      type: "SUBSCRIPTION_STATUS_CHANGE",
      data: { subscription: { id: "sub_1" } },
    });
    const parsedUnknown = provider.parseWebhook(unknownPayload);
    assert.strictEqual(parsedUnknown.type, "IGNORED");
    assert.strictEqual(parsedUnknown.rawType, "SUBSCRIPTION_STATUS_CHANGE");
    console.log("✓ Unknown event returned IGNORED without throwing");

    // =========================================================================
    // SCENARIO 12: Paise arithmetic and currency precision
    // =========================================================================
    console.log("\n--- SCENARIO 12: Paise Arithmetic & Precision ---");
    assert.strictEqual(rupeesToPaise(500), 50000);
    assert.strictEqual(rupeesToPaise(500.5), 50050);
    assert.strictEqual(paiseToRupees(50000), 500);
    assert.strictEqual(paiseToRupees(50050), 500.5);
    assert.strictEqual(formatINR(500), "₹500");
    console.log("✓ Paise arithmetic and currency formatting verified");

    console.log("\n=================================================================");
    console.log("   ALL 12 MEDRELLA PAYMENT & NOTIFICATION SCENARIOS PASSED!     ");
    console.log("=================================================================\n");
  } finally {
    console.log("Cleaning up test records...");
    try {
      if (doctor?.id) {
        // Delete test availability and appointments
        await db.notificationDelivery.deleteMany({
          where: { appointment: { availability: { doctorId: doctor.id } } },
        });
        await db.notification.deleteMany({
          where: {
            userId: {
              in: [doctorUser?.id, patientUser1?.id, patientUser2?.id].filter(Boolean) as string[],
            },
          },
        });
        await db.refund.deleteMany({
          where: { payment: { appointment: { availability: { doctorId: doctor.id } } } },
        });
        await db.payment.deleteMany({
          where: { appointment: { availability: { doctorId: doctor.id } } },
        });
        await db.appointment.deleteMany({
          where: { availability: { doctorId: doctor.id } },
        });
        await db.availability.deleteMany({
          where: { doctorId: doctor.id },
        });
        await db.doctor.delete({ where: { id: doctor.id } });
      }
      if (doctorUser?.id) await db.user.delete({ where: { id: doctorUser.id } });
      if (patient1?.id) await db.patient.delete({ where: { id: patient1.id } });
      if (patientUser1?.id) await db.user.delete({ where: { id: patientUser1.id } });
      if (patient2?.id) await db.patient.delete({ where: { id: patient2.id } });
      if (patientUser2?.id) await db.user.delete({ where: { id: patientUser2.id } });
      console.log("✓ Cleaned up test records.");
    } catch (cleanErr) {
      console.warn("Cleanup notice:", cleanErr);
    }
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
