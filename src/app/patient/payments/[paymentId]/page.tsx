import { requireRole } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { toPaymentDto } from "@/lib/serializers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PrintReceiptButton } from "./print-button";
import { formatDateTimeIST } from "@/lib/time";
import { formatINR } from "@/lib/money";
import { ArrowLeft, ShieldCheck, Stethoscope } from "lucide-react";

interface ReceiptPageProps {
  params: Promise<{
    paymentId: string;
  }>;
}

export default async function PaymentReceiptPage({ params }: ReceiptPageProps) {
  const user = await requireRole(Role.PATIENT);
  const resolvedParams = await params;
  const paymentId = resolvedParams.paymentId;

  const rawPayment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      appointment: {
        include: {
          patient: true,
          availability: {
            include: {
              doctor: {
                include: { user: { select: { name: true } } },
              },
            },
          },
        },
      },
      refunds: {
        orderBy: { requestedAt: "desc" },
      },
    },
  });

  if (!rawPayment || rawPayment.appointment.patient.userId !== user.id) {
    notFound();
  }

  const payment = toPaymentDto(rawPayment);
  const paidTime = payment.paidAt ? `${formatDateTimeIST(new Date(payment.paidAt))} IST` : "—";
  const slotTime = `${formatDateTimeIST(new Date(payment.slotStartTime))} IST`;

  return (
    <div className="container max-w-3xl mx-auto py-8 px-4 sm:px-6">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <Link
          href="/patient/payments"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-2" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Payments
        </Link>
        <PrintReceiptButton />
      </div>

      <div className="bg-card border border-border/80 rounded-2xl p-8 sm:p-10 shadow-sm print:shadow-none print:border-none print:p-0">
        {/* Header */}
        <div className="border-b border-border/70 pb-6 mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Stethoscope className="h-4 w-4" />
              </div>
              <span className="font-bold text-xl tracking-tight text-foreground">Medrella Healthcare</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Official Payment Receipt & Tax Invoice</p>
          </div>
          <div className="text-left sm:text-right">
            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-xs px-2.5 py-1">
              {payment.status === "PAID" ? "Payment Confirmed" : payment.status}
            </Badge>
            <div className="text-xs font-mono text-muted-foreground mt-1">Receipt ID: {payment.id}</div>
          </div>
        </div>

        {/* Transaction Info Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 text-sm">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billed To</span>
            <div className="font-semibold text-foreground text-base">{user.name || "Patient"}</div>
            <div className="text-muted-foreground">{user.email}</div>
          </div>
          <div className="space-y-1 sm:text-right">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Practitioner</span>
            <div className="font-semibold text-foreground text-base">Dr. {payment.doctorName}</div>
            <div className="text-muted-foreground">{payment.doctorSpecialization}</div>
          </div>
        </div>

        {/* Breakdown Table */}
        <div className="border border-border/70 rounded-xl overflow-hidden mb-8">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 border-b border-border/70 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              <tr>
                <th className="py-3 px-4">Item Description</th>
                <th className="py-3 px-4">Scheduled Slot (IST)</th>
                <th className="py-3 px-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              <tr>
                <td className="py-4 px-4">
                  <div className="font-semibold text-foreground">Outpatient Medical Consultation</div>
                  <div className="text-xs text-muted-foreground">Gateway Ref: {payment.providerOrderId}</div>
                </td>
                <td className="py-4 px-4 text-muted-foreground">{slotTime}</td>
                <td className="py-4 px-4 text-right font-bold text-foreground text-base">
                  {formatINR(payment.amount)}
                </td>
              </tr>
            </tbody>
            <tfoot className="bg-muted/30 border-t border-border/70 text-sm font-semibold">
              <tr>
                <td colSpan={2} className="py-3 px-4 text-right text-muted-foreground">Total Paid:</td>
                <td className="py-3 px-4 text-right text-primary text-lg font-bold">{formatINR(payment.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Meta Details */}
        <div className="bg-muted/40 rounded-xl p-5 text-xs text-muted-foreground space-y-2 border border-border/50 mb-8">
          <div className="flex justify-between">
            <span>Payment Processor:</span>
            <span className="font-medium text-foreground uppercase">{payment.provider}</span>
          </div>
          <div className="flex justify-between">
            <span>Payment Timestamp:</span>
            <span className="font-medium text-foreground">{paidTime}</span>
          </div>
          {payment.providerPaymentId && (
            <div className="flex justify-between">
              <span>Processor Reference ID:</span>
              <span className="font-mono text-foreground">{payment.providerPaymentId}</span>
            </div>
          )}
          {payment.method && (
            <div className="flex justify-between">
              <span>Payment Instrument:</span>
              <span className="font-medium text-foreground uppercase">{payment.method}</span>
            </div>
          )}
        </div>

        {/* Refund Timeline (if refunds exist) */}
        {payment.refunds.length > 0 && (
          <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-5 mb-8">
            <h3 className="text-sm font-bold text-amber-800 flex items-center gap-1.5 mb-3">
              <ShieldCheck className="h-4 w-4" />
              Refund Activity
            </h3>
            <div className="space-y-3">
              {payment.refunds.map((ref) => (
                <div key={ref.id} className="text-xs border-b border-amber-500/20 pb-2.5 last:border-b-0 last:pb-0 flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-foreground">
                      Refund {formatINR(ref.amount)} ({ref.status.toLowerCase()})
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      Requested on {formatDateTimeIST(new Date(ref.requestedAt))} IST • Tracking: {ref.providerRefundId}
                    </div>
                    {ref.failureReason && (
                      <div className="text-destructive mt-0.5">Failure reason: {ref.failureReason}</div>
                    )}
                  </div>
                  <Badge variant={ref.status === "SUCCESS" ? "default" : "outline"} className="text-[10px]">
                    {ref.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-[11px] text-muted-foreground border-t border-border/70 pt-6">
          <p>This is a computer-generated receipt and requires no physical signature.</p>
          <p className="mt-1">Medrella Outpatient Consultation Booking Platform. All times displayed in Indian Standard Time (IST).</p>
        </div>
      </div>
    </div>
  );
}
