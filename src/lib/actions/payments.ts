"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, AppointmentStatus, PaymentStatus, RefundStatus } from "@/generated/prisma/client";
import { releaseSlot } from "@/lib/slots";
import { getPaymentProvider } from "@/lib/payments/factory";
import { handlePaymentSuccess } from "@/lib/payments/service";
import { rupeesToPaise } from "@/lib/money";
import { revalidatePath } from "next/cache";

/**
 * Cancels an active provisional checkout hold (PENDING_PAYMENT) on behalf of a patient.
 * Re-checks gateway first to ensure money was not already captured.
 */
export async function cancelHoldAction(appointmentId: string) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    return { success: false, error: "Patient profile not found." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!appointment || appointment.patientId !== user.patient.id) {
    return { success: false, error: "Hold not found or unauthorized." };
  }

  if (appointment.status !== AppointmentStatus.PENDING_PAYMENT) {
    return { success: false, error: "Only provisional checkout holds can be cancelled through this action." };
  }

  const payment = appointment.payments[0];
  const provider = getPaymentProvider();

  // 1. Verify with payment gateway: if already paid, do not cancel!
  if (payment) {
    try {
      const order = await provider.getOrder(payment.providerOrderId);
      if (order.orderStatus === "PAID") {
        await handlePaymentSuccess(payment.providerOrderId);
        return {
          success: false,
          error: "Your payment was received and confirmed. The appointment is booked.",
        };
      }
    } catch {
      // Order status check failed; proceed with hold cancellation
    }
  }

  // 2. Transactionally cancel hold and release slot
  try {
    await db.$transaction(
      async (tx) => {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancelledBy: "PATIENT",
            cancellationReason: "Provisional hold cancelled by patient",
            cancelledAt: new Date(),
          },
        });

        if (payment) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.ABANDONED },
          });
        }

        await releaseSlot(tx, appointment.availabilityId);
      },
      { maxWait: 10000, timeout: 20000 }
    );

    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath(`/doctors/${appointment.availabilityId}`);

    return { success: true, message: "Provisional hold cancelled and consultation slot freed." };
  } catch (error) {
    console.error("[cancelHoldAction] Error cancelling hold:", error);
    return { success: false, error: "Failed to cancel hold. Please try again." };
  }
}

/**
 * Retries a failed refund from the Admin oversight console.
 */
export async function retryRefundAction(refundId: string) {
  await requireRole(Role.ADMIN);

  const refund = await db.refund.findUnique({
    where: { id: refundId },
    include: { payment: true },
  });

  if (!refund) {
    return { success: false, error: "Refund record not found." };
  }

  if (refund.status === RefundStatus.SUCCESS) {
    return { success: true, message: "Refund is already processed." };
  }

  const provider = getPaymentProvider();

  try {
    const res = await provider.createRefund({
      orderId: refund.payment.providerOrderId,
      refundId: refund.providerRefundId,
      amountPaise: rupeesToPaise(Number(refund.amount)),
      note: refund.note || "Admin manual retry",
    });

    const newStatus = res.status === "SUCCESS" ? RefundStatus.SUCCESS : RefundStatus.PENDING;

    await db.refund.update({
      where: { id: refundId },
      data: {
        status: newStatus,
        providerRefundRef: res.cfRefundId || refund.providerRefundRef,
        attempts: { increment: 1 },
        processedAt: newStatus === RefundStatus.SUCCESS ? new Date() : null,
      },
    });

    // Clear needsAttention if successful
    if (newStatus === RefundStatus.SUCCESS) {
      await db.payment.update({
        where: { id: refund.paymentId },
        data: { needsAttention: false, attentionReason: null },
      });
    }

    revalidatePath("/admin/payments");

    return {
      success: true,
      message: `Refund submitted (${newStatus.toLowerCase()}).`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Manual retry failed";
    await db.refund.update({
      where: { id: refundId },
      data: {
        attempts: { increment: 1 },
        failureReason: errorMsg,
      },
    });

    return {
      success: false,
      error: errorMsg,
    };
  }
}
