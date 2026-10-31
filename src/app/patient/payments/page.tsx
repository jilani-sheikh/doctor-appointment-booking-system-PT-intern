import { requireRole } from "@/lib/auth";
import { Role, PaymentStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { toPaymentDto } from "@/lib/serializers";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTimeIST } from "@/lib/time";
import { formatINR } from "@/lib/money";
import { CreditCard, Receipt } from "lucide-react";
import { scheduleOpportunisticMaintenance } from "@/lib/maintenance";

interface PaymentsPageProps {
  searchParams: Promise<{
    page?: string;
  }>;
}

export default async function PatientPaymentsPage({ searchParams }: PaymentsPageProps) {
  const user = await requireRole(Role.PATIENT);
  scheduleOpportunisticMaintenance();
  const resolvedParams = await searchParams;
  const page = Math.max(1, parseInt(resolvedParams.page || "1", 10));
  const pageSize = 10;
  const skip = (page - 1) * pageSize;

  const whereClause: Prisma.PaymentWhereInput = {
    appointment: {
      patientId: user.patient?.id,
    },
    NOT: {
      status: PaymentStatus.FAILED,
      providerPaymentId: null,
    },
  };

  const [totalCount, rawPayments] = await Promise.all([
    db.payment.count({
      where: whereClause,
    }),
    db.payment.findMany({
      where: whereClause,
      include: {
        appointment: {
          include: {
            availability: {
              include: {
                doctor: {
                  include: { user: { select: { name: true } } },
                },
              },
            },
          },
        },
        refunds: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);

  const payments = rawPayments.map(toPaymentDto);
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <CreditCard className="h-7 w-7 text-primary" />
            Payment History
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            View consultation transactions, receipts, and refund statuses.
          </p>
        </div>
        <Link href="/patient/appointments" className={buttonVariants({ variant: "outline" })}>
          My Consultations
        </Link>
      </div>

      {payments.length === 0 ? (
        <div className="bg-card border border-border/80 rounded-2xl p-12 text-center">
          <CreditCard className="h-12 w-12 text-muted-foreground/60 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-1">No Payments Recorded</h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
            You do not have any transaction history yet. Paid consultation bookings will appear here.
          </p>
          <Link href="/doctors" className={buttonVariants()}>
            Book a Consultation
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-card border border-border/80 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  <tr>
                    <th className="py-3.5 px-4">Date (IST)</th>
                    <th className="py-3.5 px-4">Practitioner</th>
                    <th className="py-3.5 px-4">Order Ref</th>
                    <th className="py-3.5 px-4">Amount</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {payments.map((p) => {
                    let statusBadge = <Badge variant="outline">{p.status}</Badge>;
                    if (p.status === "PAID") {
                      statusBadge = (
                        <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-500/30">
                          Paid
                        </Badge>
                      );
                    } else if (p.status === "FAILED") {
                      statusBadge = (
                        <Badge variant="destructive">
                          Failed
                        </Badge>
                      );
                    } else if (p.status === "EXPIRED" || p.status === "ABANDONED") {
                      statusBadge = (
                        <Badge variant="secondary" className="text-muted-foreground">
                          {p.status === "EXPIRED" ? "Expired" : "Abandoned"}
                        </Badge>
                      );
                    }

                    return (
                      <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-4 px-4 font-medium text-foreground whitespace-nowrap">
                          {formatDateTimeIST(new Date(p.createdAt))}
                        </td>
                        <td className="py-4 px-4">
                          <div className="font-semibold text-foreground">Dr. {p.doctorName}</div>
                          <div className="text-xs text-muted-foreground">{p.doctorSpecialization}</div>
                        </td>
                        <td className="py-4 px-4 font-mono text-xs text-muted-foreground">
                          {p.providerOrderId}
                        </td>
                        <td className="py-4 px-4 font-bold text-foreground">
                          {formatINR(p.amount)}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex flex-col gap-1 items-start">
                            {statusBadge}
                            {p.refundStatus && (
                              <span className="text-[11px] font-medium text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                {p.refundStatus} {p.totalRefunded > 0 ? `(${formatINR(p.totalRefunded)})` : ""}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-right">
                          <Link
                            href={`/patient/payments/${p.id}`}
                            className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1.5 text-xs" })}
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Receipt
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center py-2 px-1">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages} ({totalCount} total)
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/patient/payments?page=${page - 1}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/patient/payments?page=${page + 1}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
