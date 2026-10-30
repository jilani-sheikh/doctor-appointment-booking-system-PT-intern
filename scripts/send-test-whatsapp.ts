import { sendWhatsAppMessage } from "../src/lib/notifications/whatsapp/channel";

const recipient = process.argv[2];
if (!recipient) {
  console.error("Usage: npm exec tsx scripts/send-test-whatsapp.ts <recipient>");
  process.exit(1);
}

try {
  const result = await sendWhatsAppMessage(
    "appointment_reminder",
    { doctorName: "Practitioner", startTime: new Date(), endTime: new Date(Date.now() + 30 * 60 * 1000) },
    recipient
  );
  if (result.success) {
    console.log("success");
  } else {
    console.log(`Twilio error code: ${result.errorCode ?? "none"}; message: ${result.error ?? "delivery failed"}`);
  }
} catch (error) {
  console.log(`Twilio error code: none; message: ${error instanceof Error ? error.message : "configuration failure"}`);
  process.exitCode = 1;
}
