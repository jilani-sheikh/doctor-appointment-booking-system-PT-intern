import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { getCronSecret } from "@/lib/env";
import { expireStaleHolds, handlePaymentSuccess } from "@/lib/payments/service";
import { dispatchDueNotifications } from "@/lib/notifications/index";
import { getPaymentProvider } from "@/lib/payments/factory";
import { PaymentStatus, RefundStatus } from "@/generated/prisma/client";
import { rupeesToPaise } from "@/lib/money";

export const runtime = "nodejs";

function verifyCronAuth(req: NextRequest): boolean {
  try {
    const configuredSecret = getCronSecret();
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }

    const providedToken = authHeader.substring(7).trim();
    const tokenBuffer = Buffer.from(providedToken, "utf8");
    const secretBuffer = Buffer.from(configuredSecret, "utf8");

    if (tokenBuffer.length !== secretBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(tokenBuffer, secretBuffer);
  } catch {
    return false;
  }
}

async function handleCronTick() {
  const summary: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  const provider = getPaymentProvider();

  // 1. Expire stale PENDING_PAYMENT checkout holds
  try {
    const holdRes = await expireStaleHolds(30);
    summary.holdsExpired = holdRes.expiredCount;
  } catch (err: unknown) {
    summary.holdsError = err instanceof Error ? err.message : "Error expiring holds";
  }

  // 2. Dispatch due outbox notifications
  try {
    const dispatchRes = await dispatchDueNotifications(50);
    summary.notifications = dispatchRes;
  } catch (err: unknown) {
    summary.notificationsError = err instanceof Error ? err.message : "Error dispatching notifications";
  }

  // 3. Reconcile PENDING payments older than 2 minutes
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const pendingPayments = await db.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        createdAt: { lt: twoMinutesAgo },
      },
      take: 20,
    });

    let paymentsReconciled = 0;
    for (const payment of pendingPayments) {
      try {
        const orderData = await provider.getOrder(payment.providerOrderId);
        if (orderData.orderStatus === "PAID") {
          await handlePaymentSuccess(payment.providerOrderId);
          paymentsReconciled++;
        } else if (orderData.orderStatus === "EXPIRED" || orderData.orderStatus === "TERMINATED") {
          await db.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.EXPIRED },
          });
          paymentsReconciled++;
        }
      } catch {
        // Individual order poll error
      }
    }
    summary.paymentsReconciled = paymentsReconciled;
  } catch (err: unknown) {
    summary.paymentsReconcileError = err instanceof Error ? err.message : "Error reconciling payments";
  }

  // 4. Reconcile PENDING refunds older than 2 minutes
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const pendingRefunds = await db.refund.findMany({
      where: {
        status: RefundStatus.PENDING,
        requestedAt: { lt: twoMinutesAgo },
      },
      include: { payment: true },
      take: 20,
    });

    let refundsReconciled = 0;
    for (const refund of pendingRefunds) {
      try {
        const refundData = await provider.getRefund(refund.payment.providerOrderId, refund.providerRefundId);
        if (refundData.status === "SUCCESS") {
          await db.refund.update({
            where: { id: refund.id },
            data: {
              status: RefundStatus.SUCCESS,
              processedAt: new Date(),
              providerRefundRef: refundData.cfRefundId || refund.providerRefundRef,
            },
          });
          refundsReconciled++;
        } else if (refundData.status === "FAILED") {
          await db.refund.update({
            where: { id: refund.id },
            data: {
              status: RefundStatus.FAILED,
              failureReason: refundData.failureReason || "Gateway refund failed",
            },
          });
          refundsReconciled++;
        }
      } catch {
        // Individual refund poll error
      }
    }
    summary.refundsReconciled = refundsReconciled;
  } catch (err: unknown) {
    summary.refundsReconcileError = err instanceof Error ? err.message : "Error reconciling refunds";
  }

  // 5. Retry FAILED refunds (up to 3 attempts with backoff)
  try {
    const retryableRefunds = await db.refund.findMany({
      where: {
        status: RefundStatus.FAILED,
        attempts: { lt: 3 },
      },
      include: { payment: true },
      take: 10,
    });

    let refundsRetried = 0;
    for (const refund of retryableRefunds) {
      try {
        const res = await provider.createRefund({
          orderId: refund.payment.providerOrderId,
          refundId: refund.providerRefundId,
          amountPaise: rupeesToPaise(Number(refund.amount)),
          note: refund.note || undefined,
        });

        await db.refund.update({
          where: { id: refund.id },
          data: {
            status: res.status === "SUCCESS" ? RefundStatus.SUCCESS : RefundStatus.PENDING,
            providerRefundRef: res.cfRefundId || refund.providerRefundRef,
            attempts: refund.attempts + 1,
            processedAt: res.status === "SUCCESS" ? new Date() : null,
          },
        });
        refundsRetried++;
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : "Retry attempt failed";
        await db.refund.update({
          where: { id: refund.id },
          data: {
            attempts: refund.attempts + 1,
            failureReason: retryMsg,
          },
        });
      }
    }
    summary.refundsRetried = refundsRetried;
  } catch (err: unknown) {
    summary.refundsRetryError = err instanceof Error ? err.message : "Error retrying refunds";
  }

  return summary;
}

export async function POST(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized cron tick" }, { status: 401 });
  }

  const result = await handleCronTick();
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized cron tick" }, { status: 401 });
  }

  const result = await handleCronTick();
  return NextResponse.json(result, { status: 200 });
}
