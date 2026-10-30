import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { sendEmail } from "../src/lib/email/client";
import { isResendConfigured } from "../src/lib/env";

async function main() {
  const recipient = process.argv[2];
  if (!recipient) {
    console.error("Usage: npx tsx scripts/send-test-email.ts <recipient-email>");
    process.exit(1);
  }

  if (!isResendConfigured()) {
    console.log("RESEND_API_KEY is not configured.");
    return;
  }

  console.log(`Sending test email to ${recipient}...`);
  const result = await sendEmail({
    to: recipient,
    subject: "Medrella Test Notification",
    html: "<p>This is a test notification from Medrella healthcare booking system.</p>",
    text: "This is a test notification from Medrella healthcare booking system.",
  });

  if (result.success) {
    console.log(`Email dispatched successfully! Message ID: ${result.id}`);
  } else {
    console.log(`Resend Error: ${result.error}`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
