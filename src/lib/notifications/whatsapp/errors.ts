export type WhatsAppErrorClass = "retryable" | "non_retryable";

export const TWILIO_ERROR_REASONS: Record<string, string> = {
  "63015": "recipient has not joined the sandbox",
  "63016": "outside the 24-hour window; recipient must message the sandbox number first",
  "21211": "invalid phone number",
  "20003": "Twilio authentication failed",
  "63038": "Twilio trial limit reached",
};

export function classifyWhatsAppError(httpStatus: number, errorCode?: string | number): {
  classification: WhatsAppErrorClass;
  reason: string;
} {
  const code = errorCode === undefined ? undefined : String(errorCode);
  if (code === "20429") {
    return { classification: "retryable", reason: "Twilio rate limit exceeded" };
  }
  if (code && TWILIO_ERROR_REASONS[code]) {
    return { classification: "non_retryable", reason: TWILIO_ERROR_REASONS[code] };
  }
  if (httpStatus === 429 || httpStatus >= 500) {
    return { classification: "retryable", reason: "Twilio temporary delivery failure" };
  }
  return { classification: "non_retryable", reason: "Twilio rejected the message" };
}
