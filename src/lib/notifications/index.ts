import { db } from "@/lib/db";
import { DeliveryStatus, NotificationChannel, AppointmentStatus, type Prisma } from "@/generated/prisma/client";
import { sendEmail } from "@/lib/email/client";
import {
  renderBookingConfirmedEmail,
  renderPaymentReceiptEmail,
  renderAppointmentCancelledEmail,
  renderAppointmentRescheduledEmail,
  renderRefundStatusEmail,
  renderPaymentFailedHoldEmail,
  renderAppointmentReminderEmail,
  renderDoctorNewBookingEmail,
} from "@/lib/email/templates/index";

// Re-export in-app notification helpers
export { createNotification, createManyNotifications } from "@/lib/notifications";

export interface DeliveryPayload {
  doctorName?: string;
  specialization?: string;
  startTime?: string | Date;
  slotStartTime?: string | Date;
  arrivalWindow?: string;
  amountRupees?: number;
  providerOrderId?: string;
  providerPaymentId?: string;
  paidAt?: string | Date;
  paymentId?: string;
  cancelledBy?: string;
  refundSummary?: string;
  oldStartTime?: string | Date;
  newStartTime?: string | Date;
  status?: "PENDING" | "FAILED" | "REQUESTED" | "SUCCESS";
  providerRefundId?: string;
  failureReason?: string;
  reason?: string;
  offsetMinutes?: number;
  patientName?: string;
}

export interface EnqueueEmailParams {
  userId: string;
  appointmentId?: string | null;
  template:
    | "booking_confirmed"
    | "payment_receipt"
    | "appointment_cancelled"
    | "appointment_rescheduled"
    | "refund_status"
    | "payment_failed_hold"
    | "reminder"
    | "doctor_new_booking";
  payload: Record<string, unknown>;
  dedupeKey: string;
  scheduledFor?: Date;
}

/**
 * Enqueues an email into the outbox table (NotificationDelivery).
 * Uses unique dedupeKey to ensure retries and duplicate events are strictly idempotent.
 * If scheduledFor is past/now, attempts immediate best-effort delivery.
 */
export async function enqueueEmail(
  txOrDb: Prisma.TransactionClient | typeof db,
  params: EnqueueEmailParams
) {
  const scheduledFor = params.scheduledFor ?? new Date();

  const delivery = await txOrDb.notificationDelivery.upsert({
    where: { dedupeKey: params.dedupeKey },
    create: {
      userId: params.userId,
      appointmentId: params.appointmentId ?? null,
      channel: NotificationChannel.EMAIL,
      template: params.template,
      payload: params.payload as Prisma.InputJsonValue,
      dedupeKey: params.dedupeKey,
      scheduledFor,
      status: DeliveryStatus.PENDING,
    },
    update: {}, // If dedupeKey already exists, preserve existing delivery state
  });

  // For immediate emails, attempt best-effort delivery if invoked outside transaction
  if (scheduledFor <= new Date() && !("transaction" in txOrDb)) {
    try {
      await deliverSingleNotification(delivery.id);
    } catch (err) {
      console.error(`[Outbox] Best-effort delivery attempt failed for ${delivery.id}:`, err);
    }
  }

  return delivery;
}

/**
 * Delivers a single claimed outbox notification row.
 */
export async function deliverSingleNotification(deliveryId: string): Promise<boolean> {
  const delivery = await db.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          emailRemindersEnabled: true,
        },
      },
      appointment: {
        include: {
          availability: true,
        },
      },
    },
  });

  if (!delivery) return false;

  // 1. If recipient has no email, mark SKIPPED
  if (!delivery.user?.email) {
    await db.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.SKIPPED, lastError: "User has no email address" },
    });
    return true;
  }

  // 2. Reminder specific checks:
  if (delivery.template === "reminder") {
    // Check if user disabled reminders
    if (!delivery.user.emailRemindersEnabled) {
      await db.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.SKIPPED, lastError: "Email reminders disabled by user" },
      });
      return true;
    }

    // Verify appointment is still CONFIRMED and slot is in the future
    if (
      !delivery.appointment ||
      delivery.appointment.status !== AppointmentStatus.CONFIRMED ||
      delivery.appointment.availability.startTime <= new Date()
    ) {
      await db.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.SKIPPED, lastError: "Appointment not active or slot expired" },
      });
      return true;
    }
  }

  const payload = (delivery.payload || {}) as unknown as DeliveryPayload;
  let emailContent: { html: string; text: string } | null = null;
  let subject = "Medrella Notification";

  switch (delivery.template) {
    case "booking_confirmed":
      subject = "Your Consultation is Booked & Confirmed - Medrella";
      emailContent = renderBookingConfirmedEmail({
        patientName: delivery.user.name || "Patient",
        doctorName: payload.doctorName || "Practitioner",
        specialization: payload.specialization || "General",
        startTime: new Date(payload.startTime || Date.now()),
        arrivalWindow: payload.arrivalWindow,
      });
      break;

    case "payment_receipt":
      subject = "Payment Receipt for Consultation - Medrella";
      emailContent = renderPaymentReceiptEmail({
        patientName: delivery.user.name || "Patient",
        doctorName: payload.doctorName || "Practitioner",
        amountRupees: Number(payload.amountRupees || 0),
        providerOrderId: payload.providerOrderId || "",
        providerPaymentId: payload.providerPaymentId,
        paidAt: new Date(payload.paidAt || Date.now()),
        paymentId: payload.paymentId || "",
      });
      break;

    case "appointment_cancelled":
      subject = "Appointment Cancellation Notice - Medrella";
      emailContent = renderAppointmentCancelledEmail({
        patientName: delivery.user.name || "Patient",
        doctorName: payload.doctorName || "Practitioner",
        startTime: new Date(payload.startTime || Date.now()),
        cancelledBy: payload.cancelledBy || "SYSTEM",
        refundSummary: payload.refundSummary,
      });
      break;

    case "appointment_rescheduled":
      subject = "Appointment Rescheduled - Medrella";
      emailContent = renderAppointmentRescheduledEmail({
        patientName: delivery.user.name || "Patient",
        doctorName: payload.doctorName || "Practitioner",
        oldStartTime: new Date(payload.oldStartTime || Date.now()),
        newStartTime: new Date(payload.newStartTime || Date.now()),
      });
      break;

    case "refund_status":
      subject = `Refund ${payload.status === "SUCCESS" ? "Processed" : "Status Update"} - Medrella`;
      emailContent = renderRefundStatusEmail({
        patientName: delivery.user.name || "Patient",
        doctorName: payload.doctorName || "Practitioner",
        amountRupees: Number(payload.amountRupees || 0),
        status: payload.status || "PENDING",
        providerRefundId: payload.providerRefundId || "",
        failureReason: payload.failureReason,
      });
      break;

    case "payment_failed_hold":
      subject = "Consultation Hold Expired - Medrella";
      emailContent = renderPaymentFailedHoldEmail({
        patientName: delivery.user.name || "Patient",
        doctorName: payload.doctorName || "Practitioner",
        reason: payload.reason || "Payment timeout",
      });
      break;

    case "reminder":
      subject = "Reminder: Upcoming Outpatient Consultation - Medrella";
      emailContent = renderAppointmentReminderEmail({
        patientName: delivery.user.name || "Patient",
        doctorName: payload.doctorName || "Practitioner",
        startTime: new Date(payload.slotStartTime || payload.startTime || delivery.appointment?.availability.startTime || Date.now()),
        offsetMinutes: payload.offsetMinutes || 120,
      });
      break;

    case "doctor_new_booking":
      subject = "New Patient Consultation Booked - Medrella";
      emailContent = renderDoctorNewBookingEmail({
        doctorName: delivery.user.name || "Doctor",
        patientName: payload.patientName || "Patient",
        startTime: new Date(payload.startTime || Date.now()),
      });
      break;

    default:
      console.warn(`[Outbox] Unknown template ${delivery.template}`);
      await db.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.SKIPPED, lastError: "Unknown template" },
      });
      return false;
  }

  const sendResult = await sendEmail({
    to: delivery.user.email,
    subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  const now = new Date();
  if (sendResult.success) {
    await db.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.SENT,
        sentAt: now,
        lockedAt: null,
      },
    });
    return true;
  } else {
    const attempts = delivery.attempts + 1;
    const finalFailure = attempts >= 5;

    await db.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: finalFailure ? DeliveryStatus.FAILED : DeliveryStatus.PENDING,
        attempts,
        lastError: sendResult.error || "Delivery failed",
        lockedAt: null,
      },
    });
    return false;
  }
}

/**
 * Dispatches due outbox notifications (used by cron tick).
 * Atomically locks rows using SKIP LOCKED to prevent concurrent duplicate delivery.
 */
export async function dispatchDueNotifications(limit = 50): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const now = new Date();

  // 1. Recover stale PROCESSING rows (> 10 minutes)
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  await db.notificationDelivery.updateMany({
    where: {
      status: DeliveryStatus.PROCESSING,
      lockedAt: { lt: tenMinutesAgo },
    },
    data: {
      status: DeliveryStatus.PENDING,
      lockedAt: null,
    },
  });

  // 2. Atomically claim pending rows
  const claimedRows: Array<{ id: string }> = await db.$queryRaw`
    UPDATE "notification_deliveries"
    SET "status" = 'PROCESSING'::"DeliveryStatus", "locked_at" = NOW()
    WHERE "id" IN (
      SELECT "id" FROM "notification_deliveries"
      WHERE "status" = 'PENDING'::"DeliveryStatus"
        AND "scheduled_for" <= NOW()
      ORDER BY "scheduled_for" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"::text AS "id";
  `;

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of claimedRows) {
    try {
      const delivered = await deliverSingleNotification(row.id);
      if (delivered) {
        // Verify final state
        const updated = await db.notificationDelivery.findUnique({
          where: { id: row.id },
          select: { status: true },
        });
        if (updated?.status === DeliveryStatus.SENT) sent++;
        else if (updated?.status === DeliveryStatus.SKIPPED) skipped++;
        else failed++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`[Outbox] Error dispatching row ${row.id}:`, err);
      failed++;
    }
  }

  return { claimed: claimedRows.length, sent, failed, skipped };
}
