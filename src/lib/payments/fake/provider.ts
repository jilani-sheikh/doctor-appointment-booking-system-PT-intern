import { paiseToRupees } from "@/lib/money";
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

export interface FakeOrderRecord {
  orderId: string;
  cfOrderId: string;
  amountPaise: number;
  currency: string;
  orderStatus: "ACTIVE" | "PAID" | "EXPIRED" | "TERMINATED";
  expiresAt: Date;
  payments: PaymentAttempt[];
  refunds: Map<string, GetRefundResult>;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  public orders = new Map<string, FakeOrderRecord>();
  public shouldRejectSignature = false;
  public mockSignature = "valid_fake_signature";

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const cfOrderId = `cf_fake_${Date.now()}`;
    const paymentSessionId = `session_fake_${params.orderId}_${Date.now()}`;

    this.orders.set(params.orderId, {
      orderId: params.orderId,
      cfOrderId,
      amountPaise: params.amountPaise,
      currency: params.currency || "INR",
      orderStatus: "ACTIVE",
      expiresAt: params.expiresAt,
      payments: [],
      refunds: new Map(),
    });

    return {
      orderId: params.orderId,
      cfOrderId,
      paymentSessionId,
      orderStatus: "ACTIVE",
    };
  }

  async getOrder(orderId: string): Promise<GetOrderResult> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`[FakePaymentProvider] Order ${orderId} not found`);
    }

    return {
      orderId: order.orderId,
      cfOrderId: order.cfOrderId,
      orderAmount: paiseToRupees(order.amountPaise),
      orderCurrency: order.currency,
      orderStatus: order.orderStatus,
    };
  }

  async getOrderPayments(orderId: string): Promise<PaymentAttempt[]> {
    const order = this.orders.get(orderId);
    if (!order) return [];
    return [...order.payments];
  }

  async createRefund(params: CreateRefundParams): Promise<CreateRefundResult> {
    const order = this.orders.get(params.orderId);
    const cfRefundId = `cf_ref_${Date.now()}`;

    const refundRecord: GetRefundResult = {
      refundId: params.refundId,
      cfRefundId,
      status: "SUCCESS",
      amount: paiseToRupees(params.amountPaise),
    };

    if (order) {
      order.refunds.set(params.refundId, refundRecord);
    }

    return {
      refundId: params.refundId,
      cfRefundId,
      status: "SUCCESS",
    };
  }

  async getRefund(orderId: string, refundId: string): Promise<GetRefundResult> {
    const order = this.orders.get(orderId);
    if (!order) {
      return {
        refundId,
        status: "FAILED",
        amount: 0,
        failureReason: "Order not found",
      };
    }

    const refund = order.refunds.get(refundId);
    if (!refund) {
      return {
        refundId,
        status: "FAILED",
        amount: 0,
        failureReason: "Refund record not found",
      };
    }

    return refund;
  }

  verifyWebhookSignature(headers: WebhookHeaders): WebhookVerificationResult {
    if (this.shouldRejectSignature) {
      return { valid: false, reason: "INVALID_SIGNATURE" };
    }
    if (!headers.signature || !headers.timestamp) {
      return { valid: false, reason: "MISSING_HEADERS" };
    }
    return { valid: true };
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return {
        type: "IGNORED",
        rawType: "UNPARSEABLE",
        orderId: null,
        status: "IGNORED",
        rawPayload: {},
      };
    }

    const rawType = (json.type as string) || "UNKNOWN";
    const data = (json.data || {}) as Record<string, Record<string, unknown>>;
    const order = (data.order || {}) as Record<string, unknown>;
    const payment = (data.payment || {}) as Record<string, unknown>;
    const refund = (data.refund || {}) as Record<string, unknown>;

    const orderId = (order.order_id as string) || (refund.order_id as string) || (json.order_id as string) || null;

    if (rawType === "PAYMENT_SUCCESS_WEBHOOK") {
      return {
        type: "PAYMENT_SUCCESS",
        rawType,
        orderId,
        paymentId: payment.cf_payment_id ? String(payment.cf_payment_id) : "cf_pay_mock",
        status: "SUCCESS",
        amount: Number(payment.payment_amount || order.order_amount || 0),
        rawPayload: json,
      };
    }

    if (rawType === "PAYMENT_FAILED_WEBHOOK") {
      return {
        type: "PAYMENT_FAILED",
        rawType,
        orderId,
        paymentId: payment.cf_payment_id ? String(payment.cf_payment_id) : null,
        status: "FAILED",
        failureReason: payment.payment_message ? String(payment.payment_message) : "Declined",
        rawPayload: json,
      };
    }

    if (rawType === "PAYMENT_USER_DROPPED_WEBHOOK") {
      return {
        type: "PAYMENT_USER_DROPPED",
        rawType,
        orderId,
        paymentId: null,
        status: "USER_DROPPED",
        rawPayload: json,
      };
    }

    if (rawType === "REFUND_STATUS_WEBHOOK") {
      return {
        type: "REFUND_STATUS",
        rawType,
        orderId,
        refundId: refund.refund_id ? String(refund.refund_id) : null,
        cfRefundId: refund.cf_refund_id ? String(refund.cf_refund_id) : null,
        status: refund.refund_status ? String(refund.refund_status) : "SUCCESS",
        amount: Number(refund.refund_amount || 0),
        rawPayload: json,
      };
    }

    if (rawType === "AUTO_REFUND_STATUS_WEBHOOK") {
      return {
        type: "AUTO_REFUND_STATUS",
        rawType,
        orderId,
        refundId: refund.refund_id ? String(refund.refund_id) : null,
        cfRefundId: refund.cf_refund_id ? String(refund.cf_refund_id) : null,
        status: refund.refund_status ? String(refund.refund_status) : "SUCCESS",
        amount: Number(refund.refund_amount || 0),
        rawPayload: json,
      };
    }

    return {
      type: "IGNORED",
      rawType,
      orderId,
      status: "IGNORED",
      rawPayload: json,
    };
  }

  // Helper test simulation methods
  markOrderPaid(orderId: string, amountPaise?: number) {
    const order = this.orders.get(orderId);
    if (order) {
      order.orderStatus = "PAID";
      order.payments.push({
        paymentId: `pay_${Date.now()}`,
        cfPaymentId: `cf_${Date.now()}`,
        paymentStatus: "SUCCESS",
        paymentAmount: paiseToRupees(amountPaise ?? order.amountPaise),
        paymentCurrency: order.currency,
        paymentTime: new Date(),
      });
    }
  }

  markOrderFailed(orderId: string, reason = "Card declined") {
    const order = this.orders.get(orderId);
    if (order) {
      order.payments.push({
        paymentId: `pay_${Date.now()}`,
        paymentStatus: "FAILED",
        paymentAmount: paiseToRupees(order.amountPaise),
        paymentCurrency: order.currency,
        paymentMessage: reason,
        paymentTime: new Date(),
      });
    }
  }
}
