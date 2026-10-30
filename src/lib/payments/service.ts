import { db } from "@/lib/db";
import {
  AppointmentStatus,
  PaymentStatus,
  RefundStatus,
  RefundReason,
  SlotStatus,
  WaveStatus,
  NotificationType,
  VisitStream,
  Prisma,
} from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { releaseSlot } from "@/lib/slots";
import { createNotification } from "@/lib/notifications";
import { enqueueEmail, enqueuePatientNotifications } from "@/lib/notifications/index";
import { syncAppointmentReminders } from "@/lib/notifications/reminders";
import { getPaymentProvider } from "./factory";
import { calculateRefundPolicy } from "@/lib/refund-policy";
import { rupeesToPaise, paiseToRupees, paiseToDecimalString } from "@/lib/money";
import { normalizeIndianPhoneNumber } from "@/lib/phone";
import { getAppUrl } from "@/lib/env";
import { HOLD_MINUTES } from "@/lib/constants";
import { formatSlotDateTimeRangeIST } from "@/lib/time";
import { formatWaveArrivalWindowIST } from "@/lib/waves";

export interface BookWithPaymentInput {
  patientId: string;
  userId: string;
  patientName: string;
  patientEmail?: string | null;
  patientPhone?: string | null;
  availabilityId: string;
  reason?: string;
  stream: string;
}

export interface BookWithPaymentResult {
  success: boolean;
  orderId?: string;
  paymentSessionId?: string;
  appointmentId?: string;
  error?: string;
}

import { computeCashfreeOrderExpiry } from "./types";
export { computeCashfreeOrderExpiry };

/**
 * Creates an unconfirmed appointment hold (PENDING_PAYMENT) and initiates Cashfree order.
 */
export async function bookWithPaymentHold(input: BookWithPaymentInput): Promise<BookWithPaymentResult> {
  const { patientId, userId, patientName, patientEmail, patientPhone, availabilityId, reason, stream } = input;

  // 1. Phone validation (Amendment 6)
  const normalizedPhone = normalizeIndianPhoneNumber(patientPhone);
  if (!normalizedPhone) {
    return {
      success: false,
      error: "Please complete your patient onboarding profile with a valid 10-digit mobile phone number before booking.",
    };
  }

  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);

  // 2. Fetch slot and doctor fee
  const slot = await db.availability.findUnique({
    where: { id: availabilityId },
    include: {
      doctor: {
        select: {
          id: true,
          consultationFee: true,
          user: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!slot) {
    return { success: false, error: "The selected consultation slot could not be found." };
  }

  const feeRupees = Number(slot.doctor.consultationFee);
  const feePaise = rupeesToPaise(feeRupees);

  // Generate unique order ID
  const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  let appointmentId = "";
  let paymentId = "";

  // 3. In one short transaction: conditionally lock slot, create PENDING_PAYMENT appointment and Payment
  try {
    const txResult = await db.$transaction(
      async (tx) => {
        // Conditionally claim slot: AVAILABLE -> BOOKED
        const slotUpdate = await tx.availability.updateMany({
          where: {
            id: availabilityId,
            status: SlotStatus.AVAILABLE,
            startTime: { gt: oneHourFromNow },
          },
          data: { status: SlotStatus.BOOKED },
        });

        if (slotUpdate.count !== 1) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        // Create appointment in PENDING_PAYMENT
        const appt = await tx.appointment.create({
          data: {
            patientId,
            availabilityId,
            reason,
            stream: stream as VisitStream,
            status: AppointmentStatus.PENDING_PAYMENT,
            holdExpiresAt,
          },
        });

        // Create Payment in CREATED
        const payment = await tx.payment.create({
          data: {
            appointmentId: appt.id,
            provider: "cashfree",
            providerOrderId: orderId,
            amount: new Prisma.Decimal(paiseToDecimalString(feePaise)),
            currency: "INR",
            status: PaymentStatus.CREATED,
            expiresAt: holdExpiresAt,
          },
        });

        return { appt, payment };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    appointmentId = txResult.appt.id;
    paymentId = txResult.payment.id;
  } catch (err: unknown) {
    const isSlotUnavailable =
      (err instanceof Error && err.message === "SLOT_UNAVAILABLE") ||
      (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002");
    if (isSlotUnavailable) {
      return {
        success: false,
        error: "This consultation slot is no longer available. Please select another time.",
      };
    }
    console.error("[bookWithPaymentHold] Error creating provisional hold:", err);
    return {
      success: false,
      error: "Unable to reserve consultation slot. Please try again.",
    };
  }

  // 4. AFTER transaction: call payment provider createOrder
  const provider = getPaymentProvider();
  const appUrl = getAppUrl();
  const returnUrl = `${appUrl}/patient/payments/return?order_id=${encodeURIComponent(orderId)}`;
  const notifyUrl = `${appUrl}/api/webhooks/cashfree`;

  const orderNow = new Date();
  const orderExpiryTime = computeCashfreeOrderExpiry(holdExpiresAt, orderNow);

  try {
    const orderRes = await provider.createOrder({
      orderId,
      amountPaise: feePaise,
      currency: "INR",
      customer: {
        customerId: userId,
        phone: normalizedPhone,
        name: patientName,
        email: patientEmail || undefined,
      },
      returnUrl,
      notifyUrl,
      expiresAt: orderExpiryTime,
    });

    // Update payment record with paymentSessionId and final order expiry
    await db.payment.update({
      where: { id: paymentId },
      data: {
        paymentSessionId: orderRes.paymentSessionId,
        providerPaymentId: orderRes.cfOrderId,
        expiresAt: orderExpiryTime,
      },
    });

    return {
      success: true,
      orderId,
      paymentSessionId: orderRes.paymentSessionId,
      appointmentId,
    };
  } catch (providerError: unknown) {
    console.error("[bookWithPaymentHold] Payment provider createOrder failed. Rolling back hold:", providerError);
    const providerMsg = providerError instanceof Error ? providerError.message : "Order creation failed at payment gateway";

    // Rollback the hold: cancel appointment, release slot, mark payment FAILED
    try {
      await db.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.FAILED,
            failureReason: providerMsg,
          },
        });

        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancelledBy: "SYSTEM",
            cancellationReason: "Payment gateway order creation failed",
          },
        });

        await releaseSlot(tx, availabilityId);
      });
    } catch (rollbackError) {
      console.error("[bookWithPaymentHold] Critical rollback error:", rollbackError);
    }

    return {
      success: false,
      error: "Online payment initiation failed. Please try again or choose another slot.",
    };
  }
}

/**
 * Resumes checkout for an active provisional hold by generating a fresh Cashfree order
 * using the exact same order_expiry_time rules.
 */
export async function resumeHoldPayment(appointmentId: string, userId: string): Promise<{
  success: boolean;
  paymentSessionId?: string;
  orderId?: string;
  error?: string;
}> {
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { include: { user: true } },
      availability: {
        include: {
          doctor: {
            include: { user: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!appointment || appointment.patient.userId !== userId) {
    return { success: false, error: "Consultation hold not found or unauthorized." };
  }

  if (appointment.status !== AppointmentStatus.PENDING_PAYMENT) {
    return { success: false, error: "This appointment is no longer pending payment." };
  }

  const now = new Date();
  if (!appointment.holdExpiresAt || appointment.holdExpiresAt <= now) {
    await expireStaleHolds(1);
    return { success: false, error: "Your 20-minute provisional hold has expired. Please select another slot." };
  }

  const doctor = appointment.availability.doctor;
  const feeRupees = Number(doctor.consultationFee);
  const feePaise = rupeesToPaise(feeRupees);

  // Generate a fresh unique order ID
  const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const provider = getPaymentProvider();
  const appUrl = getAppUrl();
  const returnUrl = `${appUrl}/patient/payments/return?order_id=${encodeURIComponent(orderId)}`;
  const notifyUrl = `${appUrl}/api/webhooks/cashfree`;

  const orderNow = new Date();
  const orderExpiryTime = computeCashfreeOrderExpiry(appointment.holdExpiresAt, orderNow);
  const normalizedPhone = normalizeIndianPhoneNumber(appointment.patient.phone) || "9999999999";

  try {
    const orderRes = await provider.createOrder({
      orderId,
      amountPaise: feePaise,
      currency: "INR",
      customer: {
        customerId: userId,
        phone: normalizedPhone,
        name: appointment.patient.user.name || "Patient",
        email: appointment.patient.user.email || undefined,
      },
      returnUrl,
      notifyUrl,
      expiresAt: orderExpiryTime,
    });

    // Record the new Payment row in CREATED status
    await db.payment.create({
      data: {
        appointmentId: appointment.id,
        provider: "cashfree",
        providerOrderId: orderId,
        paymentSessionId: orderRes.paymentSessionId,
        amount: new Prisma.Decimal(paiseToDecimalString(feePaise)),
        currency: "INR",
        status: PaymentStatus.CREATED,
        expiresAt: orderExpiryTime,
      },
    });

    return {
      success: true,
      paymentSessionId: orderRes.paymentSessionId,
      orderId,
    };
  } catch (err: unknown) {
    console.error("[resumeHoldPayment] Cashfree createOrder failed:", err);
    const msg = err instanceof Error ? err.message : "Failed to initiate payment gateway session.";
    return { success: false, error: msg };
  }
}

/**
 * Idempotently finalizes a confirmed appointment.
 * Used by payment success, return-page verification, reconciliation, free path, and disabled mode.
 */
export async function finalizeConfirmedAppointment(appointmentId: string): Promise<boolean> {
  // Fetch appointment with availability and doctor
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      availability: {
        include: {
          doctor: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      },
      payments: {
        where: { status: PaymentStatus.PAID },
        orderBy: { paidAt: "desc" },
        take: 1,
      },
    },
  });

  if (!appointment) return false;

  // If already confirmed, nothing to do (idempotent)
  if (appointment.status === AppointmentStatus.CONFIRMED) {
    return true;
  }

  const doctor = appointment.availability.doctor;
  const slotStartTime = appointment.availability.startTime;
  const slotEndTime = appointment.availability.endTime;

  let waveIdToAssign: string | null = null;
  let assignedWaveArrivalWindow: string | null = null;

  // 1. Transactional state change: PENDING_PAYMENT or PENDING -> CONFIRMED
  const updateResult = await db.$transaction(
    async (tx) => {
      // Find matching published wave if capacity remains
      const matchingWave = await tx.wave.findFirst({
        where: {
          OR: [
            { doctorId: doctor.id },
            { doctorId: null, specialization: doctor.specialization },
          ],
          status: WaveStatus.PUBLISHED,
          windowStart: { lte: slotStartTime },
          windowEnd: { gt: slotStartTime },
        },
        include: {
          _count: { select: { appointments: true } },
        },
      });

      if (matchingWave && matchingWave._count.appointments < matchingWave.capacity) {
        waveIdToAssign = matchingWave.id;
        assignedWaveArrivalWindow = formatWaveArrivalWindowIST(
          matchingWave.windowStart,
          matchingWave.windowEnd
        );
      }

      // Conditional updateMany to guarantee single execution
      const updated = await tx.appointment.updateMany({
        where: {
          id: appointmentId,
          status: { in: [AppointmentStatus.PENDING_PAYMENT, AppointmentStatus.PENDING] },
        },
        data: {
          status: AppointmentStatus.CONFIRMED,
          waveId: waveIdToAssign,
          holdExpiresAt: null,
        },
      });

      if (updated.count === 1) {
        // Sync reminders inside transaction
        await syncAppointmentReminders(tx, {
          appointmentId,
          userId: appointment.patient.userId,
          slotStartTime,
          slotEndTime,
          status: AppointmentStatus.CONFIRMED,
        });
      }

      return updated.count === 1;
    },
    { maxWait: 10000, timeout: 20000 }
  );

  if (!updateResult) {
    return false;
  }

  // 2. Post-commit notifications (never block or fail booking if notifications fail)
  const slotTimeFormatted = formatSlotDateTimeRangeIST(slotStartTime, slotEndTime);
  const doctorName = doctor.user.name ?? "Practitioner";
  const arrivalNote = assignedWaveArrivalWindow
    ? ` Arrival window: ${assignedWaveArrivalWindow} IST.`
    : "";

  try {
    // In-app patient notification
    await createNotification({
      userId: appointment.patient.userId,
      type: NotificationType.APPOINTMENT_CONFIRMED,
      title: "Your appointment is booked",
      body: `Your consultation with Dr. ${doctorName} on ${slotTimeFormatted} IST is confirmed.${arrivalNote}`,
      href: "/patient/appointments",
    });

    // In-app doctor notification
    await createNotification({
      userId: doctor.user.id,
      type: NotificationType.GENERAL,
      title: "New Booking Confirmed",
      body: `New booking: ${appointment.patient.user.name ?? "Patient"}, ${slotTimeFormatted} IST`,
      href: "/doctor/queue",
    });

    // Outbox email: booking confirmed
    await enqueuePatientNotifications(db, {
      userId: appointment.patient.userId,
      appointmentId,
      template: "booking_confirmed",
      payload: {
        doctorName,
        specialization: doctor.specialization,
        startTime: slotStartTime.toISOString(),
        endTime: slotEndTime.toISOString(),
        arrivalWindow: assignedWaveArrivalWindow,
      },
      dedupeKey: `email:booking_confirmed:${appointmentId}`,
      whatsappTemplate: "appointment_confirmed",
      whatsappDedupeKey: `whatsapp:appointment_confirmed:${appointmentId}`,
    });

    // Outbox email and WhatsApp receipt (if payment row exists and was paid)
    const paidPayment = appointment.payments[0];
    if (paidPayment) {
      await enqueuePatientNotifications(db, {
        userId: appointment.patient.userId,
        appointmentId,
        template: "payment_receipt",
        payload: {
          doctorName,
          amountRupees: Number(paidPayment.amount),
          providerOrderId: paidPayment.providerOrderId,
          providerPaymentId: paidPayment.providerPaymentId,
          paidAt: paidPayment.paidAt ? paidPayment.paidAt.toISOString() : new Date().toISOString(),
          paymentId: paidPayment.id,
        },
        dedupeKey: `email:payment_receipt:${paidPayment.id}`,
        whatsappTemplate: "payment_receipt",
        whatsappDedupeKey: `whatsapp:payment_receipt:${paidPayment.id}`,
      });
    }

    // Outbox email: doctor new booking notification (best-effort)
    await enqueueEmail(db, {
      userId: doctor.user.id,
      appointmentId,
      template: "doctor_new_booking",
      payload: {
        patientName: appointment.patient.user.name || "Patient",
        startTime: slotStartTime.toISOString(),
      },
      dedupeKey: `email:doctor_new_booking:${appointmentId}`,
    });
  } catch (notifErr) {
    console.error("[finalizeConfirmedAppointment] Error sending post-commit notifications:", notifErr);
  }

  // Cache revalidation
  try {
    revalidatePath(`/doctors/${doctor.id}`);
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/patient/payments");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/waves");
  } catch {
    // Ignore revalidate errors in non-request contexts
  }

  return true;
}

/**
 * Handles verified payment success event from webhook or return page.
 */
export async function handlePaymentSuccess(
  orderId: string,
  paymentId?: string | null,
  paidAmount?: number | null,
  method?: string | null
): Promise<boolean> {
  const payment = await db.payment.findUnique({
    where: { providerOrderId: orderId },
    include: {
      appointment: {
        include: {
          availability: true,
        },
      },
    },
  });

  if (!payment) {
    console.error(`[handlePaymentSuccess] No payment found for order ${orderId}`);
    return false;
  }

  // Already marked PAID (idempotent)
  if (payment.status === PaymentStatus.PAID) {
    return true;
  }

  const expectedAmountRupees = Number(payment.amount);
  const now = new Date();

  // Validate amount matches
  if (paidAmount !== undefined && paidAmount !== null && Math.abs(paidAmount - expectedAmountRupees) > 0.01) {
    console.error(
      `[handlePaymentSuccess] Amount mismatch on order ${orderId}: expected ${expectedAmountRupees}, received ${paidAmount}`
    );
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        needsAttention: true,
        attentionReason: `Amount mismatch: expected ₹${expectedAmountRupees}, received ₹${paidAmount}`,
      },
    });
    return false;
  }

  // 1. Mark payment PAID
  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.PAID,
      paidAt: now,
      providerPaymentId: paymentId || payment.providerPaymentId,
      method: method || payment.method,
      failureReason: null,
    },
  });

  const appt = payment.appointment;

  // 2. If appointment was cancelled by hold expiry, handle late payment recovery
  if (appt.status === AppointmentStatus.CANCELLED) {
    const thirtyMinFromNow = new Date(now.getTime() + 30 * 60 * 1000);

    // Check if slot is still available and >= 30m away
    let reclaimed = false;
    try {
      reclaimed = await db.$transaction(async (tx) => {
        const updateSlot = await tx.availability.updateMany({
          where: {
            id: appt.availabilityId,
            status: SlotStatus.AVAILABLE,
            startTime: { gt: thirtyMinFromNow },
          },
          data: { status: SlotStatus.BOOKED },
        });

        if (updateSlot.count === 1) {
          await tx.appointment.update({
            where: { id: appt.id },
            data: {
              status: AppointmentStatus.PENDING_PAYMENT,
              cancelledAt: null,
              cancelledBy: null,
              cancellationReason: null,
            },
          });
          return true;
        }
        return false;
      });
    } catch {
      reclaimed = false;
    }

    if (reclaimed) {
      await finalizeConfirmedAppointment(appt.id);
      return true;
    } else {
      // Slot was taken or past cutoff: issue full refund immediately and flag for attention
      await db.payment.update({
        where: { id: payment.id },
        data: {
          needsAttention: true,
          attentionReason: "Slot was booked by another patient before late payment arrived. 100% refund initiated.",
        },
      });

      await requestRefund({
        paymentId: payment.id,
        appointmentId: appt.id,
        reason: RefundReason.SLOT_LOST_AFTER_PAYMENT,
        note: "Consultation slot was lost after late payment. 100% refund initiated.",
      });
      return true;
    }
  }

  // 3. Normal path: finalize appointment confirmation
  await finalizeConfirmedAppointment(appt.id);
  return true;
}

/**
 * Handles payment failure event.
 */
export async function handlePaymentFailed(orderId: string, reason?: string | null): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { providerOrderId: orderId },
  });

  if (!payment || payment.status === PaymentStatus.PAID) return;

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.FAILED,
      failureReason: reason || "Payment attempt failed at gateway",
    },
  });
}

/**
 * Handles user dropped / abandoned payment event.
 */
export async function handlePaymentUserDropped(orderId: string): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { providerOrderId: orderId },
  });

  if (!payment || payment.status === PaymentStatus.PAID) return;

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.ABANDONED,
    },
  });
}

/**
 * Expires stale PENDING_PAYMENT checkout holds whose holdExpiresAt has passed.
 * Used by cron tick and cheap lazy listing checks.
 */
export async function expireStaleHolds(limit = 25): Promise<{ expiredCount: number }> {
  const now = new Date();

  const staleAppts = await db.appointment.findMany({
    where: {
      status: AppointmentStatus.PENDING_PAYMENT,
      holdExpiresAt: { lt: now },
    },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      patient: {
        include: { user: true },
      },
      availability: {
        include: {
          doctor: { include: { user: true } },
        },
      },
    },
    take: limit,
  });

  let expiredCount = 0;
  const provider = getPaymentProvider();

  for (const appt of staleAppts) {
    const payment = appt.payments[0];

    // Check gateway status once to catch delayed webhooks
    if (payment) {
      try {
        const orderData = await provider.getOrder(payment.providerOrderId);
        if (orderData.orderStatus === "PAID") {
          await handlePaymentSuccess(payment.providerOrderId);
          continue;
        }
      } catch {
        // Continue with expiry if order lookup fails
      }
    }

    try {
      await db.$transaction(
        async (tx) => {
          // Update appointment to CANCELLED
          const apptRes = await tx.appointment.updateMany({
            where: {
              id: appt.id,
              status: AppointmentStatus.PENDING_PAYMENT,
            },
            data: {
              status: AppointmentStatus.CANCELLED,
              cancelledBy: "SYSTEM",
              cancellationReason: "Consultation hold expired before payment was completed.",
              cancelledAt: now,
            },
          });

          if (apptRes.count === 1) {
            // Update payment to EXPIRED
            if (payment) {
              await tx.payment.updateMany({
                where: {
                  id: payment.id,
                  status: { not: PaymentStatus.PAID },
                },
                data: { status: PaymentStatus.EXPIRED },
              });
            }

            // Release slot back using releaseSlot helper
            await releaseSlot(tx, appt.availabilityId);
            expiredCount++;
          }
        },
        { maxWait: 10000, timeout: 20000 }
      );

      // Best-effort expiry email
      if (appt.patient.user.email) {
        await enqueueEmail(db, {
          userId: appt.patient.userId,
          appointmentId: appt.id,
          template: "payment_failed_hold",
          payload: {
            doctorName: appt.availability.doctor.user.name || "Doctor",
            reason: "Hold expired after 20 minutes without payment completion",
          },
          dedupeKey: `email:hold_expired:${appt.id}`,
        });
      }
    } catch (err) {
      console.error(`[expireStaleHolds] Error expiring appointment ${appt.id}:`, err);
    }
  }

  return { expiredCount };
}

export interface RequestRefundParams {
  paymentId: string;
  appointmentId: string;
  reason: RefundReason;
  note?: string;
  amountPaiseOverride?: number;
}

export interface RequestRefundResult {
  success: boolean;
  refundId?: string;
  status: RefundStatus;
  amountRupees: number;
  error?: string;
}

/**
 * Creates and submits a refund request to Cashfree.
 * Strictly adheres to Amendment 3:
 * Creates the Refund row in REQUESTED with unique providerRefundId BEFORE calling provider.
 * Unique constraint on (paymentId, reason, appointmentId) prevents duplicate refund rows.
 */
export async function requestRefund(params: RequestRefundParams): Promise<RequestRefundResult> {
  const { paymentId, appointmentId, reason, note, amountPaiseOverride } = params;

  // 1. Fetch payment and existing non-failed refunds
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      appointment: {
        include: {
          availability: true,
          patient: { include: { user: true } },
        },
      },
      refunds: {
        where: { status: { not: RefundStatus.FAILED } },
      },
    },
  });

  if (!payment) {
    return { success: false, status: RefundStatus.FAILED, amountRupees: 0, error: "Payment record not found." };
  }

  if (payment.status !== PaymentStatus.PAID) {
    return {
      success: false,
      status: RefundStatus.FAILED,
      amountRupees: 0,
      error: "Refunds can only be processed on PAID payments.",
    };
  }

  const totalPaidPaise = rupeesToPaise(Number(payment.amount));
  const priorRefundsPaise = payment.refunds.reduce((sum, r) => sum + rupeesToPaise(Number(r.amount)), 0);

  // 2. Compute refund amount from policy unless overridden
  let targetRefundPaise: number;
  if (amountPaiseOverride !== undefined) {
    targetRefundPaise = amountPaiseOverride;
  } else {
    const policyResult = calculateRefundPolicy({
      paidAmountPaise: totalPaidPaise,
      reason,
      slotStartTime: payment.appointment.availability.startTime,
      cancelledAt: new Date(),
      isDisrupted: Boolean(payment.appointment.disruptedAt),
      priorNonFailedRefundsPaise: priorRefundsPaise,
    });
    targetRefundPaise = policyResult.amountPaise;
  }

  if (targetRefundPaise <= 0) {
    return {
      success: true,
      status: RefundStatus.SUCCESS,
      amountRupees: 0,
      error: "No refund amount applicable under policy.",
    };
  }

  // Cap at remaining refundable
  const remainingRefundablePaise = Math.max(0, totalPaidPaise - priorRefundsPaise);
  const actualRefundPaise = Math.min(targetRefundPaise, remainingRefundablePaise);

  if (actualRefundPaise <= 0) {
    return {
      success: false,
      status: RefundStatus.FAILED,
      amountRupees: 0,
      error: "Payment has already been fully refunded.",
    };
  }

  const providerRefundId = `ref_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  let refundRecordId = "";

  // 3. Create Refund row (REQUESTED) BEFORE calling provider (Amendment 3)
  try {
    const refundRow = await db.refund.create({
      data: {
        paymentId,
        appointmentId,
        providerRefundId,
        amount: new Prisma.Decimal(paiseToDecimalString(actualRefundPaise)),
        reason,
        note: note || undefined,
        status: RefundStatus.REQUESTED,
      },
    });
    refundRecordId = refundRow.id;
  } catch (dbErr: unknown) {
    // If unique constraint violation on (paymentId, reason, appointmentId), find existing
    const isP2002 = typeof dbErr === "object" && dbErr !== null && "code" in dbErr && (dbErr as { code: string }).code === "P2002";
    if (isP2002) {
      const existing = await db.refund.findUnique({
        where: {
          paymentId_reason_appointmentId: {
            paymentId,
            reason,
            appointmentId,
          },
        },
      });
      if (existing) {
        return {
          success: true,
          refundId: existing.providerRefundId,
          status: existing.status,
          amountRupees: Number(existing.amount),
        };
      }
    }
    console.error("[requestRefund] DB error inserting refund row:", dbErr);
    return {
      success: false,
      status: RefundStatus.FAILED,
      amountRupees: paiseToRupees(actualRefundPaise),
      error: "Failed to initialize refund record.",
    };
  }

  // 4. Call payment provider to submit refund
  const provider = getPaymentProvider();
  try {
    const res = await provider.createRefund({
      orderId: payment.providerOrderId,
      refundId: providerRefundId,
      amountPaise: actualRefundPaise,
      note: note || undefined,
    });

    const finalStatus = res.status === "SUCCESS" ? RefundStatus.SUCCESS : RefundStatus.PENDING;

    await db.refund.update({
      where: { id: refundRecordId },
      data: {
        status: finalStatus,
        providerRefundRef: res.cfRefundId,
        processedAt: finalStatus === RefundStatus.SUCCESS ? new Date() : null,
      },
    });

    // Enqueue refund email
    if (payment.appointment.patient.user.email) {
      await enqueuePatientNotifications(db, {
        userId: payment.appointment.patient.userId,
        appointmentId,
        template: "refund_status",
        payload: {
          doctorName: "Practitioner",
          amountRupees: paiseToRupees(actualRefundPaise),
          status: finalStatus,
          providerRefundId,
        },
        dedupeKey: `email:refund_status:${refundRecordId}:${finalStatus}`,
        whatsappTemplate: "refund_update",
        whatsappDedupeKey: `whatsapp:refund_update:${refundRecordId}:${finalStatus}`,
      });
    }

    return {
      success: true,
      refundId: providerRefundId,
      status: finalStatus,
      amountRupees: paiseToRupees(actualRefundPaise),
    };
  } catch (providerErr: unknown) {
    console.error("[requestRefund] Provider refund failed:", providerErr);
    const providerErrMsg = providerErr instanceof Error ? providerErr.message : "Provider refund submission failed";

    await db.refund.update({
      where: { id: refundRecordId },
      data: {
        status: RefundStatus.FAILED,
        failureReason: providerErrMsg,
        attempts: 1,
      },
    });

    // Mark payment needsAttention
    await db.payment.update({
      where: { id: paymentId },
      data: {
        needsAttention: true,
        attentionReason: `Refund ${providerRefundId} failed: ${providerErrMsg}`,
      },
    });

    return {
      success: false,
      refundId: providerRefundId,
      status: RefundStatus.FAILED,
      amountRupees: paiseToRupees(actualRefundPaise),
      error: providerErrMsg,
    };
  }
}
