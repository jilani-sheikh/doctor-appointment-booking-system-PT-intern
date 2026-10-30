import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { computeCashfreeOrderExpiry } from "../src/lib/payments/types";
import {
  isCashfreeConfigured,
  getCashfreeKeyId,
  getCashfreeSecret,
  getCashfreeApiVersion,
  getCashfreeEnv,
} from "../src/lib/env";

async function main() {
  const configured = isCashfreeConfigured();
  console.log(`CASHFREE_KEY_ID: ${configured ? "set" : "missing"}`);
  console.log(`CASHFREE_SECRET: ${configured ? "set" : "missing"}`);
  console.log(`CASHFREE_ENV: ${getCashfreeEnv()}`);
  console.log(`CASHFREE_API_VERSION: ${getCashfreeApiVersion()}`);

  if (!configured) {
    console.log("[INFO] Cashfree credentials are not set in environment. Skipping live sandbox call.");
    return;
  }

  const keyId = getCashfreeKeyId();
  const secret = getCashfreeSecret();
  const apiVersion = getCashfreeApiVersion();

  const now = new Date();
  const holdExpiresAt = new Date(now.getTime() + 20 * 60 * 1000); // 20m hold
  const orderExpiry = computeCashfreeOrderExpiry(holdExpiresAt, now);
  const orderExpiryIso = orderExpiry.toISOString();

  const orderId = `test_order_${Date.now()}`;
  const payload = {
    order_id: orderId,
    order_amount: 1.0,
    order_currency: "INR",
    customer_details: {
      customer_id: "test_user_sand_1",
      customer_phone: "9999999999",
      customer_name: "Test User",
    },
    order_meta: {
      return_url: `http://localhost:3000/patient/payments/return?order_id=${orderId}`,
    },
    order_expiry_time: orderExpiryIso,
  };

  const url = "https://sandbox.cashfree.com/pg/orders";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": apiVersion,
      "x-client-id": keyId,
      "x-client-secret": secret,
    },
    body: JSON.stringify(payload),
  });

  console.log(`HTTP Status: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const fieldNames = Object.keys(data);
  console.log(`Response Field Names: ${fieldNames.join(", ")}`);
}

main().catch((err) => {
  console.error("Execution error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
