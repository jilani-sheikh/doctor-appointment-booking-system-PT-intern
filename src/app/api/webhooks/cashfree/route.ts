import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments/factory";
import { deriveWebhookDedupeKey } from "@/lib/payments/types";
import {
  handlePaymentSuccess,
  handlePaymentFailed,
  handlePaymentUserDropped,
} from "@/lib/payments/service";
import { RefundStatus, RefundReason, Prisma } from "@/generated/prisma/client";
import { paiseToDecimalString, rupeesToPaise } from "@/lib/money";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // 1. Read headers for early rejection
  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");

  if (!signature || !timestamp) {
    return NextResponse.json({ error: "Missing required webhook headers" }, { status: 401 });
  }

  // 2. Read raw body as text for signature verification
  const rawBody = await req.text();

  let provider;
  try {
    provider = getPaymentProvider();
  } catch (err) {
    console.error("[Cashfree Webhook] Payment provider initialization failed:", err);
    return NextResponse.json({ error: "Payment provider not configured" }, { status: 503 });
  }

  // 3. Verify signature and replay protection (within 5 minutes)
  const verification = provider.verifyWebhookSignature({ signature, timestamp }, rawBody);
  if (!verification.valid) {
    console.warn(`[Cashfree Webhook] Rejected unauthorized webhook: ${verification.reason}`);
    return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
  }

  // 3. Parse normalized webhook event
  const event = provider.parseWebhook(rawBody);
  const dedupeKey = deriveWebhookDedupeKey(
    provider.name,
    event.rawType,
    event.orderId,
    event.paymentId || event.refundId || event.cfRefundId,
    event.status
  );

  // 4. Idempotency check via PaymentWebhookEvent
  const existingEvent = await db.paymentWebhookEvent.findUnique({
    where: { dedupeKey },
  });

  if (existingEvent && (existingEvent.status === "PROCESSED" || existingEvent.status === "IGNORED")) {
    return NextResponse.json({ status: "already_processed" }, { status: 200 });
  }

  // Record event in database
  const webhookRecord = await db.paymentWebhookEvent.upsert({
    where: { dedupeKey },
    create: {
      provider: provider.name,
      dedupeKey,
      eventType: event.rawType,
      providerOrderId: event.orderId,
      payload: (event.rawPayload || {}) as Prisma.InputJsonValue,
      status: "RECEIVED",
    },
    update: {
      status: "RECEIVED",
    },
  });

  try {
    // 5. Unhandled or ignored event types (incident, TDR, instrument update, etc.)
    if (event.type === "IGNORED" || !event.orderId) {
      await db.paymentWebhookEvent.update({
        where: { id: webhookRecord.id },
        data: { status: "IGNORED", processedAt: new Date() },
      });
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    // 6. Handle PAYMENT_SUCCESS
    if (event.type === "PAYMENT_SUCCESS") {
      // Double check with provider API before confirming
      try {
        const orderData = await provider.getOrder(event.orderId);
        if (orderData.orderStatus !== "PAID") {
          console.warn(`[Cashfree Webhook] Order ${event.orderId} not marked PAID by provider. Status: ${orderData.orderStatus}`);
        }
      } catch (err) {
        console.warn(`[Cashfree Webhook] Failed to fetch order verification for ${event.orderId}:`, err);
      }

      await handlePaymentSuccess(event.orderId, event.paymentId, event.amount);
    }

    // 7. Handle PAYMENT_FAILED
    else if (event.type === "PAYMENT_FAILED") {
      await handlePaymentFailed(event.orderId, event.failureReason);
    }

    // 8. Handle PAYMENT_USER_DROPPED
    else if (event.type === "PAYMENT_USER_DROPPED") {
      await handlePaymentUserDropped(event.orderId);
    }

    // 9. Handle REFUND_STATUS or AUTO_REFUND_STATUS
    else if (event.type === "REFUND_STATUS" || event.type === "AUTO_REFUND_STATUS") {
      // Find matching refund by providerRefundId
      const refund = event.refundId
        ? await db.refund.findUnique({
            where: { providerRefundId: event.refundId },
          })
        : null;

      if (refund) {
        let newStatus: RefundStatus = RefundStatus.PENDING;
        if (event.status === "SUCCESS") newStatus = RefundStatus.SUCCESS;
        else if (event.status === "FAILED" || event.status === "CANCELLED") newStatus = RefundStatus.FAILED;

        await db.refund.update({
          where: { id: refund.id },
          data: {
            status: newStatus,
            providerRefundRef: event.cfRefundId || refund.providerRefundRef,
            failureReason: event.failureReason || refund.failureReason,
            processedAt: newStatus === RefundStatus.SUCCESS ? new Date() : null,
          },
        });
      } else {
        // Auto-refund / external refund we did not create
        const payment = await db.payment.findUnique({
          where: { providerOrderId: event.orderId },
          include: { appointment: true },
        });

        if (payment && event.amount) {
          const autoRefundPaise = rupeesToPaise(event.amount);
          const autoRefundId = event.refundId || event.cfRefundId || `auto_${Date.now()}`;

          await db.refund.create({
            data: {
              paymentId: payment.id,
              appointmentId: payment.appointmentId,
              providerRefundId: autoRefundId,
              providerRefundRef: event.cfRefundId,
              amount: new Prisma.Decimal(paiseToDecimalString(autoRefundPaise)),
              reason: RefundReason.POLICY_ADJUSTMENT,
              note: `Auto-refund reported by provider: ${event.failureReason || "System adjustment"}`,
              status: event.status === "SUCCESS" ? RefundStatus.SUCCESS : RefundStatus.PENDING,
              processedAt: event.status === "SUCCESS" ? new Date() : null,
            },
          });

          // Flag payment for attention on /admin/payments without silently cancelling appointment
          await db.payment.update({
            where: { id: payment.id },
            data: {
              needsAttention: true,
              attentionReason: `Auto-refund of ₹${event.amount} received from gateway (${event.status}). Review required.`,
            },
          });
        } else {
          console.warn(`[Cashfree Webhook] Unmatched refund event for order ${event.orderId}. Marking IGNORED.`);
          await db.paymentWebhookEvent.update({
            where: { id: webhookRecord.id },
            data: { status: "IGNORED", processedAt: new Date() },
          });
          return NextResponse.json({ status: "ignored_unmatched" }, { status: 200 });
        }
      }
    }

    // Mark event PROCESSED
    await db.paymentWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[Cashfree Webhook] Error processing event ${event.rawType}:`, err);
    const errorMsg = err instanceof Error ? err.message : "Internal error";
    await db.paymentWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: { status: "FAILED", error: errorMsg },
    });
    return NextResponse.json({ error: "Webhook processing error" }, { status: 500 });
  }
}
