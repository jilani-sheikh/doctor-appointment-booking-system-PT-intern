export interface CustomerDetails {
  customerId: string;
  phone: string;
  name?: string | null;
  email?: string | null;
}

export interface CreateOrderParams {
  orderId: string;
  amountPaise: number;
  currency?: string;
  customer: CustomerDetails;
  returnUrl: string;
  notifyUrl: string;
  expiresAt: Date;
}

export interface CreateOrderResult {
  orderId: string;
  cfOrderId?: string;
  paymentSessionId: string;
  orderStatus: string;
}

export interface GetOrderResult {
  orderId: string;
  cfOrderId?: string;
  orderAmount: number;
  orderCurrency: string;
  orderStatus: "PAID" | "ACTIVE" | "EXPIRED" | "TERMINATED" | string;
}

export interface PaymentAttempt {
  paymentId: string;
  cfPaymentId?: string;
  paymentStatus: "SUCCESS" | "FAILED" | "PENDING" | "USER_DROPPED" | "CANCELLED" | string;
  paymentAmount: number;
  paymentCurrency: string;
  paymentMethod?: string;
  paymentMessage?: string;
  paymentTime?: Date;
}

export interface CreateRefundParams {
  orderId: string;
  refundId: string;
  amountPaise: number;
  note?: string;
}

export interface CreateRefundResult {
  refundId: string;
  cfRefundId?: string;
  status: "REQUESTED" | "PENDING" | "SUCCESS" | "FAILED";
  failureReason?: string;
}

export interface GetRefundResult {
  refundId: string;
  cfRefundId?: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  amount: number;
  failureReason?: string;
}

export interface WebhookHeaders {
  signature?: string | null;
  timestamp?: string | null;
}

export type NormalizedWebhookEventType =
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "PAYMENT_USER_DROPPED"
  | "REFUND_STATUS"
  | "AUTO_REFUND_STATUS"
  | "IGNORED";

export interface NormalizedWebhookEvent {
  type: NormalizedWebhookEventType;
  rawType: string;
  orderId: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  cfRefundId?: string | null;
  status: string;
  amount?: number | null;
  failureReason?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: "MISSING_HEADERS" | "INVALID_SIGNATURE" | "TIMESTAMP_OUT_OF_BOUNDS" | "ERROR";
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  getOrder(orderId: string): Promise<GetOrderResult>;
  getOrderPayments(orderId: string): Promise<PaymentAttempt[]>;
  createRefund(params: CreateRefundParams): Promise<CreateRefundResult>;
  getRefund(orderId: string, refundId: string): Promise<GetRefundResult>;
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string, now?: Date): WebhookVerificationResult;
  parseWebhook(rawBody: string): NormalizedWebhookEvent;
}

/**
 * Derives a deterministic deduplication key for incoming webhook events.
 * Format: {provider}:{eventType}:{orderId}:{referenceId}:{status}
 */
export function deriveWebhookDedupeKey(
  provider: string,
  eventType: string,
  orderId?: string | null,
  referenceId?: string | null,
  status?: string | null
): string {
  const normProvider = (provider || "unknown").toLowerCase().trim();
  const normEvent = (eventType || "unknown").trim();
  const normOrder = (orderId || "no_order").trim();
  const normRef = (referenceId || "no_ref").trim();
  const normStatus = (status || "no_status").trim();
  return `${normProvider}:${normEvent}:${normOrder}:${normRef}:${normStatus}`;
}
