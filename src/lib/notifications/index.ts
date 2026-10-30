import { db } from "@/lib/db";
import { DeliveryStatus, NotificationChannel, AppointmentStatus, type Prisma } from "@/generated/prisma/client";
import { sendEmail } from "@/lib/email/client";
import { getWhatsAppMode } from "@/lib/env";
import { sendWhatsAppMessage } from "@/lib/notifications/whatsapp/channel";
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
  endTime?: string | Date;
  slotStartTime?: string | Date;
  slotEndTime?: string | Date;
  arrivalWindow?: string;
  amountRupees?: number;
  providerOrderId?: string;
  providerPaymentId?: string;
  paidAt?: string | Date;
  paymentId?: string;
  cancelledBy?: string;
  refundSummary?: string;
  oldStartTime?: string | Date;
  oldEndTime?: string | Date;
  newStartTime?: string | Date;
  newEndTime?: string | Date;
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

export interface EnqueuePatientNotificationParams extends Omit<EnqueueEmailParams, "dedupeKey"> {
  dedupeKey: string;
  whatsappTemplate?: "appointment_confirmed" | "appointment_cancelled" | "appointment_rescheduled" | "arrival_window" | "appointment_reminder" | "payment_receipt" | "refund_update";
  whatsappDedupeKey?: string;
}

/**
 * Enqueues the patient email and WhatsApp rows independently. A provider or database
 * failure in one channel must never prevent the other channel or the caller.
 */
export async function enqueuePatientNotifications(
  txOrDb: Prisma.TransactionClient | typeof db,
  params: EnqueuePatientNotificationParams
) {
  let email;
  try {
    email = await enqueueEmail(txOrDb, params);
  } catch (error) {
    console.error("[Outbox] Patient email enqueue failed:", error);
  }

  let whatsapp;
  if (getWhatsAppMode() === "twilio" && params.whatsappTemplate) {
    try {
      const recipient = await txOrDb.user.findUnique({
        where: { id: params.userId },
        select: { role: true, patient: { select: { whatsappOptIn: true } } },
      });
      if (recipient?.role?.toString() === "PATIENT" && recipient.patient?.whatsappOptIn) {
        whatsapp = await txOrDb.notificationDelivery.upsert({
          where: { dedupeKey: params.whatsappDedupeKey ?? `whatsapp:${params.whatsappTemplate}:${params.appointmentId ?? "none"}` },
          create: {
            userId: params.userId,
            appointmentId: params.appointmentId ?? null,
            channel: NotificationChannel.WHATSAPP,
            template: params.whatsappTemplate,
            payload: params.payload as Prisma.InputJsonValue,
            dedupeKey: params.whatsappDedupeKey ?? `whatsapp:${params.whatsappTemplate}:${params.appointmentId ?? "none"}`,
            scheduledFor: params.scheduledFor ?? new Date(),
            status: DeliveryStatus.PENDING,
          },
          update: {},
        });
      }
    } catch (error) {
      console.error("[Outbox] Patient WhatsApp enqueue failed:", error);
    }
  }

  return { email, whatsapp };
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
          role: true,
          emailRemindersEnabled: true,
          patient: { select: { phone: true, whatsappOptIn: true } },
        },
      },
      appointment: {
        include: {
          availability: { include: { doctor: { include: { user: { select: { name: true } } } } } },
        },
      },
    },
  });

  if (!delivery) return false;

  if (delivery.channel === NotificationChannel.WHATSAPP) {
    if (delivery.user?.role?.toString() !== "PATIENT") {
      await db.notificationDelivery.update({ where: { id: deliveryId }, data: { status: DeliveryStatus.SKIPPED, lastError: "WhatsApp is available only to patients" } });
      return true;
    }
    if (!delivery.user.patient?.whatsappOptIn) {
      await db.notificationDelivery.update({ where: { id: deliveryId }, data: { status: DeliveryStatus.CANCELLED, lastError: "WhatsApp opted out by patient" } });
      return true;
    }
    if (
      (delivery.template === "reminder" || delivery.template === "appointment_reminder") &&
      (!delivery.appointment ||
        delivery.appointment.status !== AppointmentStatus.CONFIRMED ||
        delivery.appointment.availability.startTime <= new Date())
    ) {
      await db.notificationDelivery.update({ where: { id: deliveryId }, data: { status: DeliveryStatus.SKIPPED, lastError: "Appointment not active or slot expired" } });
      return true;
    }
    const whatsappPayload = {
      ...(delivery.payload as Parameters<typeof sendWhatsAppMessage>[1]),
      ...(delivery.appointment?.availability.doctor.user.name
        ? { doctorName: delivery.appointment.availability.doctor.user.name }
        : {}),
    };
    let result;
    try {
      result = await sendWhatsAppMessage(
        delivery.template as Parameters<typeof sendWhatsAppMessage>[0],
        whatsappPayload,
        delivery.user.patient.phone
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "WhatsApp configuration error";
      console.error(`[WhatsApp] delivery=${deliveryId} message=${delivery.template} status=0 code=none configuration failure: ${message}`);
      await db.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.FAILED, attempts: delivery.attempts + 1, lastError: message, lockedAt: null },
      });
      return false;
    }
    if (result.success) {
      await db.notificationDelivery.update({ where: { id: deliveryId }, data: { status: DeliveryStatus.SENT, sentAt: new Date(), lockedAt: null } });
      return true;
    }
    const attempts = delivery.attempts + 1;
    const finalFailure = !result.retryable || attempts >= 5;
    if (result.errorCode) {
      console.warn(`[WhatsApp] delivery=${deliveryId} message=${delivery.template} status=${result.httpStatus} code=${result.errorCode}`);
    } else if (result.error === "invalid phone") {
      await db.notificationDelivery.update({ where: { id: deliveryId }, data: { status: DeliveryStatus.SKIPPED, lastError: "invalid phone", lockedAt: null } });
      return true;
    } else {
      console.warn(`[WhatsApp] delivery=${deliveryId} message=${delivery.template} status=${result.httpStatus} code=none`);
    }
    await db.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: finalFailure ? DeliveryStatus.FAILED : DeliveryStatus.PENDING,
        attempts,
        scheduledFor: finalFailure ? delivery.scheduledFor : new Date(Date.now() + Math.min(60, 2 ** attempts) * 60 * 1000),
        lastError: result.error || "WhatsApp delivery failed",
        lockedAt: null,
      },
    });
    return false;
  }

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
        startTime: new Date(payload.startTime || delivery.appointment?.availability.startTime || Date.now()),
        endTime: payload.endTime
          ? new Date(payload.endTime)
          : delivery.appointment?.availability.endTime
          ? new Date(delivery.appointment.availability.endTime)
          : undefined,
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
        startTime: new Date(payload.startTime || delivery.appointment?.availability.startTime || Date.now()),
        endTime: payload.endTime
          ? new Date(payload.endTime)
          : delivery.appointment?.availability.endTime
          ? new Date(delivery.appointment.availability.endTime)
          : undefined,
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
        oldEndTime: payload.oldEndTime ? new Date(payload.oldEndTime) : undefined,
        newStartTime: new Date(payload.newStartTime || Date.now()),
        newEndTime: payload.newEndTime ? new Date(payload.newEndTime) : undefined,
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
        endTime: payload.slotEndTime
          ? new Date(payload.slotEndTime)
          : payload.endTime
          ? new Date(payload.endTime)
          : delivery.appointment?.availability.endTime
          ? new Date(delivery.appointment.availability.endTime)
          : undefined,
        offsetMinutes: payload.offsetMinutes || 120,
      });
      break;

    case "doctor_new_booking":
      subject = "New Patient Consultation Booked - Medrella";
      emailContent = renderDoctorNewBookingEmail({
        doctorName: delivery.user.name || "Doctor",
        patientName: payload.patientName || "Patient",
        startTime: new Date(payload.startTime || delivery.appointment?.availability.startTime || Date.now()),
        endTime: payload.endTime
          ? new Date(payload.endTime)
          : delivery.appointment?.availability.endTime
          ? new Date(delivery.appointment.availability.endTime)
          : undefined,
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
        scheduledFor: finalFailure ? delivery.scheduledFor : new Date(Date.now() + Math.min(60, 2 ** attempts) * 60 * 1000),
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
