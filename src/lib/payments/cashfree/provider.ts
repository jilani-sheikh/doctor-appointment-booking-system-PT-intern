import { getCashfreeSecret } from "@/lib/env";
import { CashfreeClient, type CashfreeClientOptions } from "./client";
import { verifyCashfreeWebhookSignature } from "./signature";
import type {
  PaymentProvider,
  CreateOrderParams,
  CreateOrderResult,
  GetOrderResult,
  PaymentAttempt,
  CreateRefundParams,
  CreateRefundResult,
  GetRefundResult,
  WebhookHeaders,
  WebhookVerificationResult,
  NormalizedWebhookEvent,
} from "../types";

export class CashfreeProvider implements PaymentProvider {
  readonly name = "cashfree";
  private client: CashfreeClient;
  private secretKey: string;

  constructor(options?: CashfreeClientOptions) {
    this.client = new CashfreeClient(options);
    this.secretKey = options?.clientSecret ?? getCashfreeSecret();
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    return this.client.createOrder(params);
  }

  async getOrder(orderId: string): Promise<GetOrderResult> {
    return this.client.getOrder(orderId);
  }

  async getOrderPayments(orderId: string): Promise<PaymentAttempt[]> {
    return this.client.getOrderPayments(orderId);
  }

  async createRefund(params: CreateRefundParams): Promise<CreateRefundResult> {
    return this.client.createRefund(params);
  }

  async getRefund(orderId: string, refundId: string): Promise<GetRefundResult> {
    return this.client.getRefund(orderId, refundId);
  }

  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string, now?: Date): WebhookVerificationResult {
    return verifyCashfreeWebhookSignature(headers, rawBody, this.secretKey, now);
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return {
        type: "IGNORED",
        rawType: "UNPARSEABLE_JSON",
        orderId: null,
        status: "IGNORED",
        rawPayload: { unparseable: true },
      };
    }

    const rawType: string = (json.type as string) || (json.event as string) || "UNKNOWN_EVENT";
    const data = (json.data || {}) as Record<string, Record<string, unknown>>;

    const order = (data.order || {}) as Record<string, unknown>;
    const payment = (data.payment || {}) as Record<string, unknown>;
    const refund = (data.refund || {}) as Record<string, unknown>;

    const orderId = String(order.order_id || refund.order_id || json.order_id || "");
    const paymentId = payment.cf_payment_id ? String(payment.cf_payment_id) : undefined;
    const refundId = refund.refund_id ? String(refund.refund_id) : undefined;
    const cfRefundId = refund.cf_refund_id ? String(refund.cf_refund_id) : undefined;

    switch (rawType) {
      case "PAYMENT_SUCCESS_WEBHOOK":
        return {
          type: "PAYMENT_SUCCESS",
          rawType,
          orderId: orderId || null,
          paymentId,
          status: payment.payment_status ? String(payment.payment_status) : "SUCCESS",
          amount: payment.payment_amount ? Number(payment.payment_amount) : Number(order.order_amount || 0),
          failureReason: null,
          rawPayload: json,
        };

      case "PAYMENT_FAILED_WEBHOOK":
        return {
          type: "PAYMENT_FAILED",
          rawType,
          orderId: orderId || null,
          paymentId,
          status: payment.payment_status ? String(payment.payment_status) : "FAILED",
          amount: payment.payment_amount ? Number(payment.payment_amount) : null,
          failureReason: payment.payment_message ? String(payment.payment_message) : "Payment attempt failed at gateway",
          rawPayload: json,
        };

      case "PAYMENT_USER_DROPPED_WEBHOOK":
        return {
          type: "PAYMENT_USER_DROPPED",
          rawType,
          orderId: orderId || null,
          paymentId,
          status: "USER_DROPPED",
          amount: null,
          failureReason: payment.payment_message ? String(payment.payment_message) : "User dropped out of payment flow",
          rawPayload: json,
        };

      case "REFUND_STATUS_WEBHOOK":
      case "REFUND_STATUS_CHANGE":
        return {
          type: "REFUND_STATUS",
          rawType,
          orderId: orderId || null,
          refundId,
          cfRefundId,
          status: refund.refund_status ? String(refund.refund_status) : "PENDING",
          amount: refund.refund_amount ? Number(refund.refund_amount) : null,
          failureReason: refund.status_description ? String(refund.status_description) : null,
          rawPayload: json,
        };

      case "AUTO_REFUND_STATUS_WEBHOOK":
      case "PAYMENT_AUTO_REFUND_WEBHOOK":
        return {
          type: "AUTO_REFUND_STATUS",
          rawType,
          orderId: orderId || null,
          refundId,
          cfRefundId,
          status: refund.refund_status ? String(refund.refund_status) : "PENDING",
          amount: refund.refund_amount ? Number(refund.refund_amount) : null,
          failureReason: refund.status_description ? String(refund.status_description) : null,
          rawPayload: json,
        };

      default:
        // All other events (incident, payment verification update, success payment TDR, instrument active/failed, unknown)
        return {
          type: "IGNORED",
          rawType,
          orderId: orderId || null,
          status: "IGNORED",
          rawPayload: json,
        };
    }
  }
}
