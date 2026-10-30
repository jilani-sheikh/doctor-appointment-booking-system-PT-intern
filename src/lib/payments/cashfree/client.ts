import {
  getCashfreeKeyId,
  getCashfreeSecret,
  getCashfreeEnv,
  getCashfreeApiVersion,
} from "@/lib/env";
import { paiseToRupees } from "@/lib/money";
import type {
  CreateOrderParams,
  CreateOrderResult,
  GetOrderResult,
  PaymentAttempt,
  CreateRefundParams,
  CreateRefundResult,
  GetRefundResult,
} from "../types";

export interface CashfreeClientOptions {
  clientId?: string;
  clientSecret?: string;
  env?: "sandbox" | "production";
  apiVersion?: string;
}

export class CashfreeClient {
  private clientId: string;
  private clientSecret: string;
  private baseUrl: string;
  private apiVersion: string;

  constructor(options?: CashfreeClientOptions) {
    this.clientId = options?.clientId ?? getCashfreeKeyId();
    this.clientSecret = options?.clientSecret ?? getCashfreeSecret();
    const env = options?.env ?? getCashfreeEnv();
    this.baseUrl = env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
    this.apiVersion = options?.apiVersion ?? getCashfreeApiVersion();
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-client-id": this.clientId,
      "x-client-secret": this.clientSecret,
      "x-api-version": this.apiVersion,
      ...(options.headers as Record<string, string>),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const responseText = await response.text();
      let data: Record<string, unknown>;
      try {
        data = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {};
      } catch {
        data = { raw: responseText };
      }

      if (!response.ok) {
        const errorMsg =
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          `Cashfree API returned HTTP ${response.status}`;
        throw new Error(`[Cashfree API Error ${response.status}] ${errorMsg}`);
      }

      return data as T;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`[Cashfree API Timeout] Request to ${endpoint} timed out after 15 seconds.`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const payload = {
      order_id: params.orderId,
      order_amount: paiseToRupees(params.amountPaise),
      order_currency: params.currency || "INR",
      customer_details: {
        customer_id: params.customer.customerId,
        customer_phone: params.customer.phone,
        customer_name: params.customer.name || undefined,
        customer_email: params.customer.email || undefined,
      },
      order_meta: {
        return_url: params.returnUrl,
        notify_url: params.notifyUrl,
      },
      order_expiry_time: params.expiresAt.toISOString(),
    };

    const res = await this.request<Record<string, unknown>>("/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      orderId: (res.order_id as string) || params.orderId,
      cfOrderId: res.cf_order_id ? String(res.cf_order_id) : undefined,
      paymentSessionId: res.payment_session_id as string,
      orderStatus: (res.order_status as string) || "ACTIVE",
    };
  }

  async getOrder(orderId: string): Promise<GetOrderResult> {
    const res = await this.request<Record<string, unknown>>(`/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
    });

    return {
      orderId: (res.order_id as string) || orderId,
      cfOrderId: res.cf_order_id ? String(res.cf_order_id) : undefined,
      orderAmount: Number(res.order_amount),
      orderCurrency: (res.order_currency as string) || "INR",
      orderStatus: (res.order_status as string) || "ACTIVE",
    };
  }

  async getOrderPayments(orderId: string): Promise<PaymentAttempt[]> {
    const res = await this.request<Record<string, unknown>[]>(`/orders/${encodeURIComponent(orderId)}/payments`, {
      method: "GET",
    });

    if (!Array.isArray(res)) return [];

    return res.map((item) => ({
      paymentId: String(item.cf_payment_id || item.payment_id || ""),
      cfPaymentId: item.cf_payment_id ? String(item.cf_payment_id) : undefined,
      paymentStatus: (item.payment_status as string) || "PENDING",
      paymentAmount: Number(item.payment_amount),
      paymentCurrency: (item.payment_currency as string) || "INR",
      paymentMethod: (item.payment_group as string) || (typeof item.payment_method === "string" ? item.payment_method : undefined),
      paymentMessage: item.payment_message as string | undefined,
      paymentTime: item.payment_time ? new Date(item.payment_time as string) : undefined,
    }));
  }

  async createRefund(params: CreateRefundParams): Promise<CreateRefundResult> {
    const payload = {
      refund_id: params.refundId,
      refund_amount: paiseToRupees(params.amountPaise),
      refund_note: params.note || "Appointment cancellation refund",
      refund_speed: "STANDARD",
    };

    const res = await this.request<Record<string, unknown>>(`/orders/${encodeURIComponent(params.orderId)}/refunds`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      refundId: (res.refund_id as string) || params.refundId,
      cfRefundId: res.cf_refund_id ? String(res.cf_refund_id) : undefined,
      status: res.refund_status === "SUCCESS" ? "SUCCESS" : "PENDING",
      failureReason: res.status_description as string | undefined,
    };
  }

  async getRefund(orderId: string, refundId: string): Promise<GetRefundResult> {
    const res = await this.request<Record<string, unknown>>(
      `/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`,
      { method: "GET" }
    );

    let status: "PENDING" | "SUCCESS" | "FAILED" = "PENDING";
    if (res.refund_status === "SUCCESS") status = "SUCCESS";
    else if (res.refund_status === "FAILED" || res.refund_status === "CANCELLED") status = "FAILED";

    return {
      refundId: String(res.refund_id || refundId),
      cfRefundId: res.cf_refund_id ? String(res.cf_refund_id) : undefined,
      status,
      amount: Number(res.refund_amount),
      failureReason: res.status_description ? String(res.status_description) : undefined,
    };
  }
}
