import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const varsToCheck = [
  "DATABASE_URL",
  "DIRECT_URL",
  "CASHFREE_KEY_ID",
  "CASHFREE_APP_ID",
  "CASHFREE_SECRET",
  "CASHFREE_SECRET_KEY",
  "CASHFREE_ENV",
  "CASHFREE_API_VERSION",
  "PAYMENTS_MODE",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "EMAIL_FROM",
  "CRON_SECRET",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
];

for (const v of varsToCheck) {
  const val = process.env[v];
  const isSet = Boolean(val && val.trim().length > 0);
  if (v === "PAYMENTS_MODE") {
    console.log(`${v}: ${isSet ? `set (value: "${val}")` : "missing"}`);
  } else if (v === "CASHFREE_ENV") {
    console.log(`${v}: ${isSet ? `set (value: "${val}")` : "missing"}`);
  } else if (v === "APP_URL" || v === "NEXT_PUBLIC_APP_URL") {
    if (isSet && val) {
      try {
        const parsed = new URL(val);
        console.log(`${v}: set (host: "${parsed.host}")`);
      } catch {
        console.log(`${v}: set (invalid URL)`);
      }
    } else {
      console.log(`${v}: missing`);
    }
  } else {
    console.log(`${v}: ${isSet ? "set" : "missing"}`);
  }
}
