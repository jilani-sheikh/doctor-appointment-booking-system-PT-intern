import { getWhatsAppMode } from "@/lib/env";
import { normalizeIndianPhoneNumber } from "@/lib/phone";
import { getWhatsAppDefaultCountryCode } from "@/lib/env";
import type { NotificationChannelProvider } from "@/lib/notifications/types";
import { renderWhatsAppMessage, type WhatsAppMessageName, type WhatsAppMessagePayload } from "./messages";
import { sendTwilioWhatsApp } from "./client";

export function toWhatsAppE164(phone?: string | null): string | null {
  const normalized = normalizeIndianPhoneNumber(phone);
  return normalized ? `+${getWhatsAppDefaultCountryCode()}${normalized}` : null;
}

export class WhatsAppChannel implements NotificationChannelProvider {
  async send(input: { recipient: string; body: string }) {
    return sendTwilioWhatsApp(input.recipient, input.body);
  }
}

export async function sendWhatsAppMessage(name: WhatsAppMessageName, payload: WhatsAppMessagePayload, phone?: string | null) {
  if (getWhatsAppMode() === "disabled") {
    return { success: true, httpStatus: 0, retryable: false };
  }
  const recipient = toWhatsAppE164(phone);
  if (!recipient) {
    return { success: false, httpStatus: 0, error: "invalid phone", retryable: false };
  }
  return new WhatsAppChannel().send({ recipient, body: renderWhatsAppMessage(name, payload) });
}
