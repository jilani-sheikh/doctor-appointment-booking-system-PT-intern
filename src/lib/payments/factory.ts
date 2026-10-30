import { getPaymentsMode, isCashfreeConfigured } from "@/lib/env";
import { CashfreeProvider } from "./cashfree/provider";
import type { PaymentProvider } from "./types";

let providerOverride: PaymentProvider | null = null;

export function setPaymentProviderOverride(provider: PaymentProvider | null) {
  providerOverride = provider;
}

/**
 * Returns the configured payment provider.
 * Provider is isolated behind the PaymentProvider interface.
 */
export function getPaymentProvider(): PaymentProvider {
  if (providerOverride) {
    return providerOverride;
  }

  const mode = getPaymentsMode();
  if (mode === "cashfree") {
    if (!isCashfreeConfigured()) {
      throw new Error(
        "[Medrella Payment Config Error] PAYMENTS_MODE is 'cashfree' but CASHFREE_KEY_ID or CASHFREE_SECRET is missing."
      );
    }
    return new CashfreeProvider();
  }

  // Even if disabled, return CashfreeProvider if initialized for webhooks/reconciliation, or default
  return new CashfreeProvider();
}
