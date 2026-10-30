import { RefundReason } from "@/generated/prisma/client";
import { paiseToRupees } from "@/lib/money";

export interface RefundPolicyResult {
  percent: number;
  amountPaise: number;
  amountRupees: number;
  reason: RefundReason;
  explanation: string;
}

export interface CalculateRefundInput {
  paidAmountPaise: number;
  reason: RefundReason;
  slotStartTime: Date;
  cancelledAt?: Date;
  isDisrupted?: boolean;
  priorNonFailedRefundsPaise?: number;
}

const MS_IN_HOUR = 60 * 60 * 1000;
const MS_IN_24_HOURS = 24 * MS_IN_HOUR;
const MS_IN_2_HOURS = 2 * MS_IN_HOUR;

/**
 * Pure function to calculate refund percentage and amount based on timing and cancellation reason.
 * All internal arithmetic is performed in integer paise.
 */
export function calculateRefundPolicy(input: CalculateRefundInput): RefundPolicyResult {
  const {
    paidAmountPaise,
    reason,
    slotStartTime,
    cancelledAt = new Date(),
    isDisrupted = false,
    priorNonFailedRefundsPaise = 0,
  } = input;

  if (paidAmountPaise <= 0) {
    return {
      percent: 0,
      amountPaise: 0,
      amountRupees: 0,
      reason,
      explanation: "No payment was recorded for this appointment.",
    };
  }

  let percent = 0;
  let explanation = "";

  if (reason === RefundReason.DOCTOR_CANCELLED || reason === RefundReason.DOCTOR_ABSENCE || isDisrupted) {
    percent = 100;
    explanation = "Full 100% refund due to practitioner absence or cancellation.";
  } else if (reason === RefundReason.SLOT_LOST_AFTER_PAYMENT) {
    percent = 100;
    explanation = "Full 100% refund: consultation slot could not be secured after payment.";
  } else if (reason === RefundReason.POLICY_ADJUSTMENT) {
    percent = 100;
    explanation = "Full refund approved as a policy adjustment.";
  } else if (reason === RefundReason.PATIENT_CANCELLED) {
    const diffMs = slotStartTime.getTime() - cancelledAt.getTime();

    if (diffMs >= MS_IN_24_HOURS) {
      percent = 100;
      explanation = "100% refund (cancelled at least 24 hours prior to appointment).";
    } else if (diffMs >= MS_IN_2_HOURS) {
      percent = 50;
      explanation = "50% refund (cancelled between 2 and 24 hours prior to appointment).";
    } else {
      percent = 0;
      explanation = "No refund (cancellations within 2 hours of appointment are non-refundable).";
    }
  } else {
    percent = 0;
    explanation = "No refund applicable.";
  }

  const rawRefundPaise = Math.round((paidAmountPaise * percent) / 100);
  const remainingRefundablePaise = Math.max(0, paidAmountPaise - priorNonFailedRefundsPaise);
  const amountPaise = Math.min(rawRefundPaise, remainingRefundablePaise);

  return {
    percent,
    amountPaise,
    amountRupees: paiseToRupees(amountPaise),
    reason,
    explanation,
  };
}
