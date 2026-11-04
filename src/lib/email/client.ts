import { Resend } from "resend";
import { getResendApiKey, getResendFromEmail, isResendConfigured } from "@/lib/env";

let resendInstance: Resend | null = null;

function getResendClient(): Resend | null {
  if (!isResendConfigured()) {
    return null;
  }
  if (!resendInstance) {
    resendInstance = new Resend(getResendApiKey());
  }
  return resendInstance;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Dispatches an email via Resend.
 * Gracefully handles provider sandbox restrictions
 * without ever throwing or leaking secrets.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const client = getResendClient();
  const fromEmail = getResendFromEmail();

  if (!client) {
    console.warn(`[Medrella Email Warning] Email skipped: RESEND_API_KEY is not configured.`);
    return {
      success: false,
      error: "RESEND_API_KEY is not configured",
    };
  }

  try {
    const res = await client.emails.send({
      from: `Medrella <${fromEmail}>`,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    if (res.error) {
      const errorMsg = res.error.message || "Failed to send email via Resend";
      console.warn(`[Medrella Email Warning] Resend rejected email: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
      };
    }

    return {
      success: true,
      id: res.data?.id,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Unexpected error during Resend email dispatch";
    console.warn(`[Medrella Email Warning] Could not deliver email: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
    };
  }
}
