declare module "@cashfreepayments/cashfree-js" {
  export interface LoadOptions {
    mode: "sandbox" | "production";
  }
  export interface CheckoutOptions {
    paymentSessionId: string;
    redirectTarget?: "_self" | "_blank" | "_top" | HTMLElement;
  }
  export interface CashfreeInstance {
    checkout(options: CheckoutOptions): Promise<{ error?: { message?: string } }>;
  }
  export function load(options: LoadOptions): Promise<CashfreeInstance>;
}
