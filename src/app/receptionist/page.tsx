import { Metadata } from "next";
import { Role } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth";
import { getReceptionistDashboardData } from "@/lib/receptionist-server";
import { scheduleOpportunisticMaintenance } from "@/lib/maintenance";
import { ReceptionistDashboardView } from "./receptionist-dashboard-view";
import { ClipboardCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Reception Desk — Medrella",
  description:
    "Centralized front-desk queue management: select doctor, date, and sub-slot, check patients in, call next patients, start/complete consultations, and track Not Arrived outcomes.",
};

export default async function ReceptionistDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string }>;
}) {
  const user = await requireRole(Role.RECEPTIONIST);
  scheduleOpportunisticMaintenance();

  const resolvedParams = searchParams ? await searchParams : undefined;
  const selectedDateIST =
    resolvedParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(resolvedParams.date)
      ? resolvedParams.date
      : undefined;

  const data = await getReceptionistDashboardData(selectedDateIST);

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300 uppercase tracking-wider">
            Front Desk Operations
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1.5 flex items-center gap-2.5">
            <ClipboardCheck className="h-7 w-7 text-primary shrink-0" />
            Receptionist Portal — Centralized Queue Desk
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Signed in as <span className="font-medium text-foreground">{user.name ?? user.email ?? "Receptionist"}</span>. Manage patient check-ins, call next patients per sub-slot, start/complete consultations, and record Not Arrived outcomes.
          </p>
        </div>
      </div>

      <ReceptionistDashboardView data={data} />
    </div>
  );
}
