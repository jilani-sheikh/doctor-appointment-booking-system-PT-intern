const names = [
  "WHATSAPP_PROVIDER",
  "WHATSAPP_MODE",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
  "WHATSAPP_DEFAULT_COUNTRY_CODE",
] as const;

for (const name of names) {
  const value = process.env[name];
  if (name === "WHATSAPP_PROVIDER" || name === "WHATSAPP_MODE") {
    console.log(`${name}=${value?.trim() || "missing"}`);
  } else {
    console.log(`${name}: ${value?.trim() ? "set" : "missing"}`);
  }
}
