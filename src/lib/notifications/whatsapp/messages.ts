import { getAppUrl } from "@/lib/env";
import { formatDateIST, formatSlotRange } from "@/lib/time";

export type WhatsAppMessageName =
  | "appointment_confirmed"
  | "appointment_cancelled"
  | "appointment_rescheduled"
  | "arrival_window"
  | "appointment_reminder"
  | "payment_receipt"
  | "refund_update";

export interface WhatsAppMessagePayload {
  doctorName?: string;
  startTime?: string | Date;
  endTime?: string | Date;
  oldStartTime?: string | Date;
  oldEndTime?: string | Date;
  newStartTime?: string | Date;
  newEndTime?: string | Date;
  arrivalStartTime?: string | Date;
  arrivalEndTime?: string | Date;
  cancelledBy?: string;
  refundInitiated?: boolean;
  amountRupees?: number;
  providerOrderId?: string;
  status?: "PENDING" | "REQUESTED" | "SUCCESS" | "FAILED";
}

const date = (value: string | Date) => formatDateIST(value);
const range = (start: string | Date, end: string | Date) => formatSlotRange(start, end);

export function renderWhatsAppMessage(name: WhatsAppMessageName, payload: WhatsAppMessagePayload): string {
  const doctor = payload.doctorName || "your practitioner";
  const app = getAppUrl();
  switch (name) {
    case "appointment_confirmed":
      return `Medrella:\nYour appointment with Dr. ${doctor} is confirmed for ${date(payload.startTime!)}. Slot: ${range(payload.startTime!, payload.endTime!)} IST.`;
    case "appointment_cancelled": {
      const who = payload.cancelledBy === "PATIENT" ? "you" : payload.cancelledBy === "DOCTOR" ? "the doctor" : "the system";
      return `Medrella:\nYour appointment with Dr. ${doctor} on ${date(payload.startTime!)} (${range(payload.startTime!, payload.endTime!)} IST) was cancelled by ${who}.${payload.refundInitiated ? "\nA refund has been initiated." : ""}\n${app}/patient/appointments`;
    }
    case "appointment_rescheduled":
      return `Medrella:\nYour appointment with Dr. ${doctor} was rescheduled.\nPrevious: ${date(payload.oldStartTime!)}, ${range(payload.oldStartTime!, payload.oldEndTime!)} IST.\nNew: ${date(payload.newStartTime!)}, ${range(payload.newStartTime!, payload.newEndTime!)} IST.\n${app}/patient/appointments`;
    case "arrival_window":
      return `Medrella:\nPlease arrive between ${range(payload.arrivalStartTime!, payload.arrivalEndTime!).split(" - ")[0]} and ${range(payload.arrivalStartTime!, payload.arrivalEndTime!).split(" - ")[1]} IST. Your consultation slot is ${range(payload.startTime!, payload.endTime!)}.`;
    case "appointment_reminder":
      return `Medrella:\nReminder: your appointment with Dr. ${doctor} is on ${date(payload.startTime!)}. Slot: ${range(payload.startTime!, payload.endTime!)} IST.`;
    case "payment_receipt":
      return `Medrella:\nPayment receipt: ₹${payload.amountRupees ?? 0} for order ${payload.providerOrderId || "your consultation order"}.`;
    case "refund_update": {
      const text = payload.status === "SUCCESS" ? "A refund has been processed." : payload.status === "FAILED" ? "Your refund could not be processed." : payload.status === "REQUESTED" ? "A refund has been initiated." : "Your refund is pending.";
      return `Medrella:\n${text}\n${app}/patient/payments`;
    }
  }
}
