import { Metadata } from "next";
import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth";
import { loadCompletePatientMedicalRecord } from "@/lib/medical-records-server";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { MedicalRecordsView } from "./medical-records-view";

export const metadata: Metadata = {
  title: "My Medical Records & Prescriptions — Medrella",
  description:
    "Manage your allergies, medical conditions, medications, surgical and family history, clinical timeline, and prescriptions.",
};

const VALID_TABS = new Set([
  "overview",
  "allergies",
  "conditions",
  "medications",
  "history",
  "timeline",
  "prescriptions",
]);

interface MedicalRecordsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function PatientMedicalRecordsPage({
  searchParams,
}: MedicalRecordsPageProps) {
  const user = await requireRole(Role.PATIENT);
  const patient = user.patient;

  if (!patient) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-12 text-center">
        <p className="text-muted-foreground">Please complete your patient onboarding profile.</p>
      </div>
    );
  }

  const resolvedSearch = await searchParams;
  const initialTab =
    resolvedSearch.tab && VALID_TABS.has(resolvedSearch.tab)
      ? resolvedSearch.tab
      : "overview";

  const record = await loadCompletePatientMedicalRecord({
    patientId: patient.id,
  });

  if (!record) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-12 text-center">
        <p className="text-muted-foreground">Unable to load your patient profile.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <Link
            href="/patient/dashboard"
            className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Patient Dashboard
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1 flex items-center gap-2.5">
            <ClipboardList className="h-7 w-7 text-primary" />
            My Medical Records &amp; Prescriptions
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Maintain your personal medical profile so consulting doctors see accurate allergy, medication, and history information. Doctor-issued prescriptions remain read-only for clinical integrity.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/patient/appointments"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            My Consultations
          </Link>
        </div>
      </div>

      <MedicalRecordsView record={record} initialTab={initialTab} />
    </div>
  );
}
