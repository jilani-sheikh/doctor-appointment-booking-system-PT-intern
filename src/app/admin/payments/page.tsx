import { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { Role, PaymentStatus, RefundStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { toPaymentDto } from "@/lib/serializers";
import { AdminPaymentsView } from "./admin-payments-view";

export const metadata: Metadata = {
  title: "Payment Operations — Medrella Admin",
  description: "Monitor consultation payments, reconcile gateway settlements, and manage automated refunds.",
};

interface AdminPaymentsPageProps {
  searchParams: Promise<{
    page?: string;
  }>;
}

export default async function AdminPaymentsPage({ searchParams }: AdminPaymentsPageProps) {
  await requireRole(Role.ADMIN);

  const resolvedParams = await searchParams;
  const page = Math.max(1, parseInt(resolvedParams.page || "1", 10));
  const pageSize = 20;
  const skip = (page - 1) * pageSize;

  const paymentInclude = {
    appointment: {
      include: {
        availability: {
          include: {
            doctor: {
              include: {
                user: {
                  select: { name: true },
                },
              },
            },
          },
        },
      },
    },
    refunds: {
      orderBy: { requestedAt: "desc" as const },
    },
  };

  const [
    totalCount,
    paidPaymentsAggregate,
    successfulRefundsAggregate,
    paidCount,
    attentionCount,
    rawAttentionPayments,
    rawAllPayments,
  ] = await Promise.all([
    db.payment.count(),
    db.payment.aggregate({
      _sum: { amount: true },
      where: { status: PaymentStatus.PAID },
    }),
    db.refund.aggregate({
      _sum: { amount: true },
      where: { status: RefundStatus.SUCCESS },
    }),
    db.payment.count({
      where: { status: PaymentStatus.PAID },
    }),
    db.payment.count({
      where: {
        OR: [
          { needsAttention: true },
          { refunds: { some: { status: RefundStatus.FAILED } } },
        ],
      },
    }),
    db.payment.findMany({
      where: {
        OR: [
          { needsAttention: true },
          { refunds: { some: { status: RefundStatus.FAILED } } },
        ],
      },
      include: paymentInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.payment.findMany({
      skip,
      take: pageSize,
      include: paymentInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const totalVolumeRupees = Number(paidPaymentsAggregate._sum.amount ?? 0);
  const totalRefundedRupees = Number(successfulRefundsAggregate._sum.amount ?? 0);

  const attentionPayments = rawAttentionPayments.map(toPaymentDto);
  const allPayments = rawAllPayments.map(toPaymentDto);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Payment Operations &amp; Reconciliation
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cashfree order lifecycle audit, refund dispatch queues, and failure exception handling.
        </p>
      </div>

      <AdminPaymentsView
        metrics={{
          totalVolumeRupees,
          totalRefundedRupees,
          paidCount,
          attentionCount,
        }}
        attentionPayments={attentionPayments}
        allPayments={allPayments}
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
      />
    </div>
  );
}
