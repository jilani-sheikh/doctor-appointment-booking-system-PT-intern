"use client";

import { useTransition } from "react";
import { retryRefundAction } from "@/lib/actions/payments";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  AlertTriangle,
  RotateCcw,
  DollarSign,
  TrendingDown,
  CreditCard,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { formatDateTimeIST } from "@/lib/time";
import { formatINR } from "@/lib/money";
import type { SerializedPaymentItem } from "@/lib/serializers";

interface AdminPaymentsViewProps {
  metrics: {
    totalVolumeRupees: number;
    totalRefundedRupees: number;
    paidCount: number;
    attentionCount: number;
  };
  attentionPayments: SerializedPaymentItem[];
  allPayments: SerializedPaymentItem[];
  page: number;
  totalPages: number;
  totalCount: number;
}

export function AdminPaymentsView({
  metrics,
  attentionPayments,
  allPayments,
  page,
  totalPages,
  totalCount,
}: AdminPaymentsViewProps) {
  const [isPending, startTransition] = useTransition();

  const handleRetryRefund = (refundId: string) => {
    startTransition(async () => {
      const res = await retryRefundAction(refundId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error || "Failed to retry refund.");
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Volume Paid
            </CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{formatINR(metrics.totalVolumeRupees)}</div>
            <p className="text-xs text-muted-foreground mt-1">{metrics.paidCount} confirmed transactions</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Refunded
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-700">{formatINR(metrics.totalRefundedRupees)}</div>
            <p className="text-xs text-muted-foreground mt-1">Processed cancellations</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Paid Consultations
            </CardTitle>
            <CreditCard className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{metrics.paidCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Confirmed with gateway</p>
          </CardContent>
        </Card>

        <Card className={`border shadow-sm ${metrics.attentionCount > 0 ? "border-rose-400 bg-rose-500/5" : "border-border/80"}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Needs Attention
            </CardTitle>
            <ShieldAlert className={`h-4 w-4 ${metrics.attentionCount > 0 ? "text-rose-600" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${metrics.attentionCount > 0 ? "text-rose-600" : "text-foreground"}`}>
              {metrics.attentionCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Mismatches / Failed refunds</p>
          </CardContent>
        </Card>
      </div>

      {/* Needs Attention Section */}
      {attentionPayments.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-600" />
            <h2 className="text-lg font-bold text-foreground">Payments Needing Attention</h2>
          </div>

          <div className="bg-card border border-rose-300 dark:border-rose-900 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-rose-50/50 dark:bg-rose-950/20 border-b border-rose-200 dark:border-rose-900 text-xs uppercase tracking-wider text-rose-900 dark:text-rose-200 font-semibold">
                  <tr>
                    <th className="py-3 px-4">Order ID</th>
                    <th className="py-3 px-4">Practitioner</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Attention Reason</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {attentionPayments.map((p) => {
                    const failedRefund = p.refunds.find((r) => r.status === "FAILED");

                    return (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="py-3.5 px-4 font-mono text-xs font-semibold text-foreground">
                          {p.providerOrderId}
                        </td>
                        <td className="py-3.5 px-4">Dr. {p.doctorName}</td>
                        <td className="py-3.5 px-4 font-bold">{formatINR(p.amount)}</td>
                        <td className="py-3.5 px-4 text-xs text-rose-700 dark:text-rose-300 font-medium">
                          {p.attentionReason || p.failureReason || "Flagged for manual review"}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {failedRefund ? (
                            <Button
                              size="xs"
                              variant="destructive"
                              className="gap-1.5"
                              disabled={isPending}
                              onClick={() => handleRetryRefund(failedRefund.id)}
                            >
                              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                              Retry Refund ({failedRefund.attempts}/3)
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Review in Gateway</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* All Transactions Table */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">All Payment Transactions</h2>
        <div className="bg-card border border-border/80 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3.5 px-4">Date (IST)</th>
                  <th className="py-3.5 px-4">Order ID</th>
                  <th className="py-3.5 px-4">Practitioner</th>
                  <th className="py-3.5 px-4">Amount</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Refund Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {allPayments.map((p) => {
                  let badge = <Badge variant="outline">{p.status}</Badge>;
                  if (p.status === "PAID") badge = <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">Paid</Badge>;
                  else if (p.status === "FAILED") badge = <Badge variant="destructive">Failed</Badge>;
                  else if (p.status === "EXPIRED") badge = <Badge variant="secondary">Expired</Badge>;

                  return (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="py-3.5 px-4 text-xs font-medium whitespace-nowrap">
                        {formatDateTimeIST(new Date(p.createdAt))}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-muted-foreground">
                        {p.providerOrderId}
                      </td>
                      <td className="py-3.5 px-4 font-medium">Dr. {p.doctorName}</td>
                      <td className="py-3.5 px-4 font-bold">{formatINR(p.amount)}</td>
                      <td className="py-3.5 px-4">{badge}</td>
                      <td className="py-3.5 px-4 text-xs">
                        {p.refundStatus ? (
                          <span className="font-semibold text-amber-700 dark:text-amber-300">
                            {p.refundStatus} {p.totalRefunded > 0 ? `(${formatINR(p.totalRefunded)})` : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-between items-center py-2 px-1">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} ({totalCount} total)
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <a
                  href={`/admin/payments?page=${page - 1}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Previous
                </a>
              )}
              {page < totalPages && (
                <a
                  href={`/admin/payments?page=${page + 1}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Next
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
