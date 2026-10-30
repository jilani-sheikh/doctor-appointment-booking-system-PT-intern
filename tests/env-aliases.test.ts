import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getAppUrl,
  getCashfreeKeyId,
  getCashfreeSecret,
  getCashfreeEnv,
  getCashfreeApiVersion,
  getResendFromEmail,
  getPaymentsMode,
  getReminderOffsetsMinutes,
} from "../src/lib/env";

describe("Environment Variable Aliases & Normalization", () => {
  const originalEnv = { ...process.env };

  function resetEnv() {
    process.env = { ...originalEnv };
  }

  it("strips trailing slashes from APP_URL", () => {
    resetEnv();
    process.env.APP_URL = "https://doctorappointmentbookingsystem-pi.vercel.app///";
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(getAppUrl(), "https://doctorappointmentbookingsystem-pi.vercel.app");
  });

  it("falls back to NEXT_PUBLIC_APP_URL when APP_URL is not set", () => {
    resetEnv();
    delete process.env.APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000/";
    assert.equal(getAppUrl(), "http://localhost:3000");
  });

  it("defaults APP_URL to http://localhost:3000 if neither is set", () => {
    resetEnv();
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(getAppUrl(), "http://localhost:3000");
  });

  it("resolves CASHFREE_KEY_ID from CASHFREE_KEY_ID or CASHFREE_APP_ID", () => {
    resetEnv();
    process.env.CASHFREE_KEY_ID = "key_123";
    delete process.env.CASHFREE_APP_ID;
    assert.equal(getCashfreeKeyId(), "key_123");

    delete process.env.CASHFREE_KEY_ID;
    process.env.CASHFREE_APP_ID = "app_456";
    assert.equal(getCashfreeKeyId(), "app_456");
  });

  it("resolves CASHFREE_SECRET from CASHFREE_SECRET or CASHFREE_SECRET_KEY", () => {
    resetEnv();
    process.env.CASHFREE_SECRET = "sec_123";
    delete process.env.CASHFREE_SECRET_KEY;
    assert.equal(getCashfreeSecret(), "sec_123");

    delete process.env.CASHFREE_SECRET;
    process.env.CASHFREE_SECRET_KEY = "sec_key_456";
    assert.equal(getCashfreeSecret(), "sec_key_456");
  });

  it("resolves RESEND_FROM_EMAIL with fallback to EMAIL_FROM", () => {
    resetEnv();
    process.env.RESEND_FROM_EMAIL = "custom@example.com";
    delete process.env.EMAIL_FROM;
    assert.equal(getResendFromEmail(), "custom@example.com");

    delete process.env.RESEND_FROM_EMAIL;
    process.env.EMAIL_FROM = "fallback@example.com";
    assert.equal(getResendFromEmail(), "fallback@example.com");

    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.EMAIL_FROM;
    assert.equal(getResendFromEmail(), "onboarding@resend.dev");
  });

  it("resolves CASHFREE_ENV defaulting to sandbox and refusing invalid production", () => {
    resetEnv();
    delete process.env.CASHFREE_ENV;
    assert.equal(getCashfreeEnv(), "sandbox");

    process.env.CASHFREE_ENV = "production";
    assert.equal(getCashfreeEnv(), "production");

    process.env.CASHFREE_ENV = "other";
    assert.equal(getCashfreeEnv(), "sandbox");
  });

  it("resolves CASHFREE_API_VERSION defaulting to 2023-08-01", () => {
    resetEnv();
    delete process.env.CASHFREE_API_VERSION;
    assert.equal(getCashfreeApiVersion(), "2023-08-01");

    process.env.CASHFREE_API_VERSION = "2025-01-01";
    assert.equal(getCashfreeApiVersion(), "2025-01-01");
  });

  it("resolves PAYMENTS_MODE defaulting to disabled unless cashfree", () => {
    resetEnv();
    delete process.env.PAYMENTS_MODE;
    assert.equal(getPaymentsMode(), "disabled");

    process.env.PAYMENTS_MODE = "disabled";
    assert.equal(getPaymentsMode(), "disabled");

    process.env.PAYMENTS_MODE = "cashfree";
    assert.equal(getPaymentsMode(), "cashfree");
  });

  it("parses REMINDER_OFFSETS_MINUTES with fallback to default", () => {
    resetEnv();
    delete process.env.REMINDER_OFFSETS_MINUTES;
    assert.deepEqual(getReminderOffsetsMinutes(), [1440, 120]);

    process.env.REMINDER_OFFSETS_MINUTES = "720, 60, 15";
    assert.deepEqual(getReminderOffsetsMinutes(), [720, 60, 15]);
  });
});
