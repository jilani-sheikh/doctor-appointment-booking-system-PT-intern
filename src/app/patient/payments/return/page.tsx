import { requireRole } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments/factory";
import { handlePaymentSuccess } from "@/lib/payments/service";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { GetOrderResult } from "@/lib/payments/types";
import { CheckCircle2, AlertTriangle, Clock, XCircle, ArrowRight, RefreshCw } from "lucide-react";
import { formatDateTimeIST } from "@/lib/time";
import { formatINR } from "@/lib/money";

interface ReturnPageProps {
  searchParams: Promise<{
    order_id?: string;
  }>;
}

export default async function PaymentReturnPage({ searchParams }: ReturnPageProps) {
  const user = await requireRole(Role.PATIENT);
  const resolvedParams = await searchParams;
  const orderId = resolvedParams.order_id;

  if (!orderId) {
    return (
      <div className="container max-w-lg mx-auto py-16 px-4 text-center">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold tracking-tight mb-2">Invalid Payment Return</h1>
        <p className="text-muted-foreground mb-6">
          No order reference was provided in the return URL.
        </p>
        <Link href="/patient/appointments" className={buttonVariants()}>
          Go to Appointments
        </Link>
      </div>
    );
  }

  // 1. Fetch payment from DB and verify ownership
  const payment = await db.payment.findUnique({
    where: { providerOrderId: orderId },
    include: {
      appointment: {
        include: {
          patient: true,
          availability: {
            include: {
              doctor: { include: { user: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });

  if (!payment || payment.appointment.patient.userId !== user.id) {
    return (
      <div className="container max-w-lg mx-auto py-16 px-4 text-center">
        <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <h1 className="text-2xl font-bold tracking-tight mb-2">Order Not Found</h1>
        <p className="text-muted-foreground mb-6">
          We could not locate this payment order or you do not have permission to view it.
        </p>
        <Link href="/patient/appointments" className={buttonVariants()}>
          Go to Appointments
        </Link>
      </div>
    );
  }

  // 2. Poll provider for true gateway status
  const provider = getPaymentProvider();
  let gatewayStatus = payment.status as string;
  let orderData: GetOrderResult | null = null;

  try {
    orderData = await provider.getOrder(orderId);
    if (orderData.orderStatus === "PAID") {
      gatewayStatus = "PAID";
      await handlePaymentSuccess(orderId);
    } else {
      gatewayStatus = orderData.orderStatus;
    }
  } catch (err) {
    console.warn(`[PaymentReturnPage] Gateway poll error for ${orderId}:`, err);
  }

  const doctorName = payment.appointment.availability.doctor.user.name || "Practitioner";
  const slotTime = `${formatDateTimeIST(payment.appointment.availability.startTime)} IST`;
  const amount = Number(payment.amount);

  // 3. Render Status Views

  // (A) CONFIRMED / PAID
  if (gatewayStatus === "PAID") {
    return (
      <div className="container max-w-lg mx-auto py-16 px-4">
        <div className="bg-card border border-border/80 rounded-2xl p-8 shadow-sm text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Payment Confirmed!</h1>
          <p className="text-muted-foreground text-sm mb-6">
            Your consultation with Dr. {doctorName} is confirmed.
          </p>

          <div className="bg-muted/40 rounded-xl p-4 text-sm text-left space-y-2.5 mb-8 border border-border/50">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount Paid</span>
              <span className="font-bold text-foreground text-base">{formatINR(amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Consultation Time</span>
              <span className="font-medium text-foreground">{slotTime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order Reference</span>
              <span className="font-mono text-xs text-foreground">{orderId}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/patient/appointments"
              className={buttonVariants({ className: "gap-2" })}
            >
              View Appointments
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={`/patient/payments/${payment.id}`}
              className={buttonVariants({ variant: "outline" })}
            >
              View Receipt
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // (B) ACTIVE / PENDING VERIFICATION
  if (gatewayStatus === "ACTIVE" || gatewayStatus === "PENDING") {
    return (
      <div className="container max-w-lg mx-auto py-16 px-4">
        <div className="bg-card border border-border/80 rounded-2xl p-8 shadow-sm text-center">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto mb-6">
            <Clock className="h-10 w-10 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Confirming Payment...</h1>
          <p className="text-muted-foreground text-sm mb-6">
            We are confirming your transaction with Cashfree and your bank. This page will update automatically.
          </p>

          <meta httpEquiv="refresh" content="5" />

          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground mb-8">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            <span>Checking gateway status every 5 seconds...</span>
          </div>

          <div className="flex gap-3 justify-center">
            <Link href="/patient/appointments" className={buttonVariants({ variant: "outline" })}>
              Go to Appointments
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // (C) EXPIRED / TERMINATED
  if (gatewayStatus === "EXPIRED" || gatewayStatus === "TERMINATED") {
    return (
      <div className="container max-w-lg mx-auto py-16 px-4">
        <div className="bg-card border border-border/80 rounded-2xl p-8 shadow-sm text-center">
          <div className="w-16 h-16 rounded-full bg-slate-500/10 text-slate-600 flex items-center justify-center mx-auto mb-6">
            <Clock className="h-10 w-10" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Payment Session Expired</h1>
          <p className="text-muted-foreground text-sm mb-6">
            The 15-minute provisional hold for this consultation slot expired before payment was completed. The slot was released back to the schedule.
          </p>
          <Link href="/doctors" className={buttonVariants()}>
            Explore Available Slots
          </Link>
        </div>
      </div>
    );
  }

  // (D) FAILED
  return (
    <div className="container max-w-lg mx-auto py-16 px-4">
      <div className="bg-card border border-border/80 rounded-2xl p-8 shadow-sm text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-6">
          <XCircle className="h-10 w-10" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Payment Incomplete</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Your payment could not be completed or was cancelled. If funds were debited from your account, they will be automatically refunded by your bank.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/patient/appointments" className={buttonVariants()}>
            View My Appointments
          </Link>
          <Link href="/doctors" className={buttonVariants({ variant: "outline" })}>
            Book Another Slot
          </Link>
        </div>
      </div>
    </div>
  );
}
