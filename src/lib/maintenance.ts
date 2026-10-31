import "server-only";

import { after } from "next/server";
import { db } from "@/lib/db";
import { dispatchDueNotifications } from "@/lib/notifications/index";
import { expireStaleHolds, handlePaymentSuccess } from "@/lib/payments/service";
import { getPaymentProvider } from "@/lib/payments/factory";
import { PaymentStatus, RefundStatus } from "@/generated/prisma/client";
import { rupeesToPaise } from "@/lib/money";
import { claimMaintenanceRun, runMaintenanceSafely, type MaintenanceGate } from "@/lib/maintenance-utils";

const MAINTENANCE_KEY = "global";
export interface MaintenanceSummary {
  timestamp: string;
  holdsExpired?: number;
  notifications?: Awaited<ReturnType<typeof dispatchDueNotifications>>;
  paymentsReconciled?: number;
  refundsReconciled?: number;
  refundsRetried?: number;
  skipped?: boolean;
  error?: string;
}

const databaseGate: MaintenanceGate = {
  async claim(now, cutoff, lockUntil) {
    const claimed = await db.$queryRaw<Array<{ key: string }>>`
      UPDATE "maintenance_state"
      SET "last_started_at" = ${now}, "lock_until" = ${lockUntil}
      WHERE "key" = ${MAINTENANCE_KEY}
        AND ("last_started_at" IS NULL OR "last_started_at" <= ${cutoff})
        AND ("lock_until" IS NULL OR "lock_until" < ${now})
      RETURNING "key";
    `;
    return claimed.length === 1;
  },
  async release(lockUntil) {
    await db.$executeRaw`
      UPDATE "maintenance_state"
      SET "lock_until" = NULL
      WHERE "key" = ${MAINTENANCE_KEY} AND "lock_until" = ${lockUntil};
    `;
  },
};

export async function runMaintenance(): Promise<MaintenanceSummary> {
  const summary: MaintenanceSummary = {
    timestamp: new Date().toISOString(),
  };

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return { ...summary, skipped: true };
  }

  let claim: { claimed: boolean; lockUntil: Date };
  try {
    claim = await claimMaintenanceRun(databaseGate);
  } catch (error) {
    console.error("[Maintenance] Failed to claim maintenance run:", error);
    return { ...summary, error: "claim_failed" };
  }

  if (!claim.claimed) {
    return { ...summary, skipped: true };
  }

  try {
    try {
      summary.holdsExpired = (await expireStaleHolds(30)).expiredCount;
    } catch (error) {
      console.error("[Maintenance] Failed to expire stale holds:", error);
    }

    try {
      summary.notifications = await dispatchDueNotifications(50);
    } catch (error) {
      console.error("[Maintenance] Failed to dispatch notifications:", error);
    }

    let provider: ReturnType<typeof getPaymentProvider>;
    try {
      provider = getPaymentProvider();
    } catch (error) {
      console.error("[Maintenance] Payment provider is unavailable:", error);
      return summary;
    }
    try {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const pendingPayments = await db.payment.findMany({
        where: { status: PaymentStatus.PENDING, createdAt: { lt: twoMinutesAgo } },
        take: 20,
      });
      let reconciled = 0;
      for (const payment of pendingPayments) {
        try {
          const orderData = await provider.getOrder(payment.providerOrderId);
          if (orderData.orderStatus === "PAID") {
            await handlePaymentSuccess(payment.providerOrderId);
            reconciled++;
          } else if (orderData.orderStatus === "EXPIRED" || orderData.orderStatus === "TERMINATED") {
            await db.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.EXPIRED } });
            reconciled++;
          }
        } catch (error) {
          console.error("[Maintenance] Payment reconciliation failed:", error);
        }
      }
      summary.paymentsReconciled = reconciled;
    } catch (error) {
      console.error("[Maintenance] Failed to reconcile payments:", error);
    }

    try {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const pendingRefunds = await db.refund.findMany({
        where: { status: RefundStatus.PENDING, requestedAt: { lt: twoMinutesAgo } },
        include: { payment: true },
        take: 20,
      });
      let reconciled = 0;
      for (const refund of pendingRefunds) {
        try {
          const refundData = await provider.getRefund(
            refund.payment.providerOrderId,
            refund.providerRefundId
          );
          if (refundData.status === "SUCCESS") {
            await db.refund.update({
              where: { id: refund.id },
              data: {
                status: RefundStatus.SUCCESS,
                processedAt: new Date(),
                providerRefundRef: refundData.cfRefundId || refund.providerRefundRef,
              },
            });
            reconciled++;
          } else if (refundData.status === "FAILED") {
            await db.refund.update({
              where: { id: refund.id },
              data: {
                status: RefundStatus.FAILED,
                failureReason: refundData.failureReason || "Gateway refund failed",
              },
            });
            reconciled++;
          }
        } catch (error) {
          console.error("[Maintenance] Refund reconciliation failed:", error);
        }
      }
      summary.refundsReconciled = reconciled;
    } catch (error) {
      console.error("[Maintenance] Failed to reconcile refunds:", error);
    }

    try {
      const retryableRefunds = await db.refund.findMany({
        where: { status: RefundStatus.FAILED, attempts: { lt: 3 } },
        include: { payment: true },
        take: 10,
      });
      let retried = 0;
      for (const refund of retryableRefunds) {
        try {
          const result = await provider.createRefund({
            orderId: refund.payment.providerOrderId,
            refundId: refund.providerRefundId,
            amountPaise: rupeesToPaise(Number(refund.amount)),
            note: refund.note || undefined,
          });
          await db.refund.update({
            where: { id: refund.id },
            data: {
              status: result.status === "SUCCESS" ? RefundStatus.SUCCESS : RefundStatus.PENDING,
              providerRefundRef: result.cfRefundId || refund.providerRefundRef,
              attempts: refund.attempts + 1,
              processedAt: result.status === "SUCCESS" ? new Date() : null,
            },
          });
          retried++;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Retry attempt failed";
          console.error("[Maintenance] Failed refund retry failed:", error);
          await db.refund.update({
            where: { id: refund.id },
            data: { attempts: refund.attempts + 1, failureReason: message },
          });
        }
      }
      summary.refundsRetried = retried;
    } catch (error) {
      console.error("[Maintenance] Failed to retry refunds:", error);
    }
  } finally {
    try {
      await databaseGate.release(claim.lockUntil);
    } catch (error) {
      console.error("[Maintenance] Failed to release maintenance lock:", error);
    }
  }

  return summary;
}

export function scheduleOpportunisticMaintenance(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  try {
    after(() => runMaintenanceSafely(runMaintenance));
  } catch (error) {
    console.error("[Maintenance] Failed to schedule opportunistic run:", error);
  }
}
