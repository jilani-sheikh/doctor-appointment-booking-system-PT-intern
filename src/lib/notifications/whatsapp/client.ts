import { getTwilioConfig, getTwilioWhatsAppContentSid, type TwilioWhatsAppTemplate } from "@/lib/env";
import { classifyWhatsAppError } from "./errors";

export interface TwilioWhatsAppSendResult {
  success: boolean;
  httpStatus: number;
  messageSid?: string;
  errorCode?: string;
  error?: string;
  retryable: boolean;
}

export async function sendTwilioWhatsApp(
  to: string,
  template: TwilioWhatsAppTemplate,
  contentVariables: Record<string, string>
): Promise<TwilioWhatsAppSendResult> {
  const config = getTwilioConfig();
  const contentSid = getTwilioWhatsAppContentSid(template);
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const form = new URLSearchParams({
    From: config.from,
    To: `whatsapp:${to}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(contentVariables),
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const data = (await response.json().catch(() => ({}))) as { sid?: string; code?: number | string; message?: string };
  if (response.ok) {
    return { success: true, httpStatus: response.status, messageSid: data.sid, retryable: false };
  }
  const mapped = classifyWhatsAppError(response.status, data.code);
  return {
    success: false,
    httpStatus: response.status,
    errorCode: data.code === undefined ? undefined : String(data.code),
    error: mapped.reason,
    retryable: mapped.classification === "retryable",
  };
}
