import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  passwordResetRequestSchema,
  passwordResetSchema,
} from "../src/lib/validations/auth";
import {
  renderGoogleAccountPasswordEmail,
  renderPasswordResetEmail,
} from "../src/lib/email/templates";

describe("Password reset", () => {
  it("uses the same registration password rules", () => {
    assert.equal(
      passwordResetSchema.safeParse({
        token: "token",
        password: "short",
        confirmPassword: "short",
      }).success,
      false
    );
    assert.equal(
      passwordResetSchema.safeParse({
        token: "token",
        password: "validpass1",
        confirmPassword: "validpass1",
      }).success,
      true
    );
  });

  it("normalizes reset request email input", () => {
    const parsed = passwordResetRequestSchema.parse({ email: "  User@Example.com " });
    assert.equal(parsed.email, "user@example.com");
  });

  it("escapes reset URLs in the HTML template", () => {
    const email = renderPasswordResetEmail({
      resetUrl: "https://example.test/reset?token=a&next=<unsafe>",
      expiresAt: new Date("2026-11-05T09:30:00Z"),
    });
    assert.equal(email.html.includes("&amp;"), true);
    assert.equal(email.html.includes("<unsafe>"), false);
    assert.equal(email.text.includes("https://example.test/reset?token=a&next=<unsafe>"), true);
  });

  it("provides Google-only account guidance without a reset token", () => {
    const email = renderGoogleAccountPasswordEmail();
    assert.equal(email.html.includes("Continue with Google"), true);
    assert.equal(email.text.includes("reset token"), false);
  });
});
