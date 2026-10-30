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
 * Gracefully handles sandbox restrictions (e.g. onboarding@resend.dev recipient limits)
 * without ever throwing or leaking secrets.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const client = getResendClient();
  const fromEmail = getResendFromEmail();

  if (!client) {
    console.warn(
      `[Medrella Email] RESEND_API_KEY is not configured. Email to ${options.to} (${options.subject}) was skipped.`
    );
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
      console.warn(
        `[Medrella Email Warning] Resend rejected recipient ${options.to}: ${errorMsg}. ` +
        "(Note: In Resend sandbox mode with onboarding@resend.dev, delivery is restricted to your verified account email address.)"
      );
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
    console.warn(
      `[Medrella Email Warning] Could not deliver email to ${options.to}: ${errorMsg}`
    );
    return {
      success: false,
      error: errorMsg,
    };
  }
}
