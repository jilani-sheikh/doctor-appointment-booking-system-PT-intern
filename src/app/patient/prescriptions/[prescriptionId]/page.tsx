import { notFound } from "next/navigation";
import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  buildPatientIdentityHeader,
} from "@/lib/medical-records";
import { formatDoctorDisplayName, formatSubSlotLabel } from "@/lib/queue-tokens";
import { effectiveSlot } from "@/lib/scheduling";
import { formatDateIST, formatDateTimeIST, formatSlotDateTimeRangeIST } from "@/lib/time";
import { ArrowLeft, Calendar, FileText, ShieldCheck, Stethoscope } from "lucide-react";
import { PrintPrescriptionButton } from "./print-prescription-button";

interface PrescriptionDetailPageProps {
  params: Promise<{
    prescriptionId: string;
  }>;
}

export default async function PatientPrescriptionDetailPage({
  params,
}: PrescriptionDetailPageProps) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    notFound();
  }

  const { prescriptionId } = await params;

  const prescription = await db.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      patient: {
        select: {
          id: true,
          userId: true,
          dateOfBirth: true,
          gender: true,
          user: { select: { name: true, email: true } },
        },
      },
      appointment: {
        select: {
          id: true,
          tokenNumber: true,
          slotStart: true,
          slotEnd: true,
          availability: {
            select: {
              kind: true,
              startTime: true,
              endTime: true,
            },
          },
        },
      },
      medicines: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!prescription || prescription.patientId !== user.patient.id) {
    notFound();
  }

  const identity = buildPatientIdentityHeader({
    patientId: prescription.patient.id,
    name: prescription.patient.user.name,
    dateOfBirth: prescription.patient.dateOfBirth,
    gender: prescription.patient.gender,
  });

  const apptSlot = prescription.appointment
    ? effectiveSlot({
        slotStart: prescription.appointment.slotStart,
        slotEnd: prescription.appointment.slotEnd,
        availability: prescription.appointment.availability,
      })
    : null;

  const subSlotLabel = prescription.appointment
    ? formatSubSlotLabel({
        kind: prescription.appointment.availability.kind,
        availabilityStart: prescription.appointment.availability.startTime,
        availabilityEnd: prescription.appointment.availability.endTime,
        slotStart: prescription.appointment.slotStart,
        slotEnd: prescription.appointment.slotEnd,
      })
    : null;

  const doctorDisplay = formatDoctorDisplayName(prescription.doctorNameSnapshot);

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 sm:px-6">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6 print:hidden">
        <Link
          href="/patient/medical-records?tab=prescriptions"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-2" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Prescriptions
        </Link>
        <PrintPrescriptionButton />
      </div>

      <div className="bg-card border border-border/80 rounded-2xl p-6 sm:p-10 shadow-sm print:shadow-none print:border-none print:p-0">
        {/* Clinic Header */}
        <div className="border-b border-border/70 pb-6 mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Stethoscope className="h-4 w-4" />
              </div>
              <span className="font-bold text-xl tracking-tight text-foreground">
                Medrella Healthcare
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Official Outpatient Medical Prescription (Rx)
            </p>
          </div>
          <div className="text-left sm:text-right space-y-1">
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-xs px-2.5 py-1">
              Doctor Issued Prescription
            </Badge>
            <div className="text-xs font-mono text-muted-foreground">
              Rx ID: {prescription.id}
            </div>
            <div className="text-xs text-muted-foreground">
              Issued: {formatDateTimeIST(prescription.prescribedAt)} IST
            </div>
          </div>
        </div>

        {/* Patient & Prescriber Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6 p-4 rounded-xl bg-muted/30 border border-border/60 text-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Patient Details
            </span>
            <div className="font-bold text-foreground text-base">{identity.name}</div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
              <span className="font-mono font-semibold text-foreground/80">
                ID: {identity.patientCode}
              </span>
              {identity.ageLabel && <span>• Age: {identity.ageLabel}</span>}
              {identity.gender && <span>• {identity.gender}</span>}
            </div>
          </div>

          <div className="space-y-1 sm:text-right">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Prescribing Practitioner
            </span>
            <div className="font-bold text-foreground text-base">{doctorDisplay}</div>
            {prescription.doctorSpecializationSnapshot && (
              <div className="text-xs text-primary font-medium">
                {prescription.doctorSpecializationSnapshot}
              </div>
            )}
            {apptSlot && (
              <div className="text-xs text-muted-foreground">
                Consultation: {formatSlotDateTimeRangeIST(apptSlot.start, apptSlot.end)} IST
                {typeof prescription.appointment?.tokenNumber === "number"
                  ? ` • Token #${prescription.appointment.tokenNumber}`
                  : ""}
                {subSlotLabel ? ` (${subSlotLabel})` : ""}
              </div>
            )}
          </div>
        </div>

        {/* Diagnosis */}
        <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5 mb-1">
            <FileText className="h-3.5 w-3.5" />
            Clinical Diagnosis
          </div>
          <p className="text-sm font-medium text-foreground whitespace-pre-wrap">
            {prescription.diagnosis}
          </p>
        </div>

        {/* Medications Rx Table */}
        <div className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3">
            Rx — Prescribed Medicines ({prescription.medicines.length})
          </h2>
          <div className="border border-border/70 rounded-xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border/70 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3 px-3">#</th>
                  <th className="py-3 px-3">Medicine & Dosage</th>
                  <th className="py-3 px-3">Frequency</th>
                  <th className="py-3 px-3">Duration</th>
                  <th className="py-3 px-3">Instructions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {prescription.medicines.map((med, index) => (
                  <tr key={med.id} className="align-top">
                    <td className="py-3.5 px-3 font-semibold text-muted-foreground">
                      {index + 1}
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-bold text-foreground">{med.medicineName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Dosage: <strong className="text-foreground">{med.dosage}</strong>
                        {med.route ? ` • Route: ${med.route}` : ""}
                        {med.quantity ? ` • Qty: ${med.quantity}` : ""}
                      </div>
                      {med.notes && (
                        <div className="text-xs text-muted-foreground mt-1 italic">
                          Note: {med.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-foreground font-medium">{med.frequency}</td>
                    <td className="py-3.5 px-3 text-foreground font-medium">{med.duration}</td>
                    <td className="py-3.5 px-3 text-muted-foreground">
                      {med.instructions ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Clinical Instructions & Follow-Up */}
        {(prescription.generalInstructions ||
          prescription.lifestyleAdvice ||
          prescription.followUpRecommendation ||
          prescription.followUpDate ||
          prescription.notes) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 text-xs">
            {prescription.generalInstructions && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-1">
                <span className="font-bold uppercase tracking-wider text-muted-foreground">
                  General Instructions
                </span>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {prescription.generalInstructions}
                </p>
              </div>
            )}

            {prescription.lifestyleAdvice && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-1">
                <span className="font-bold uppercase tracking-wider text-muted-foreground">
                  Lifestyle & Diet Advice
                </span>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {prescription.lifestyleAdvice}
                </p>
              </div>
            )}

            {(prescription.followUpRecommendation || prescription.followUpDate) && (
              <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-4 space-y-1">
                <span className="font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Follow-Up Recommendation
                </span>
                {prescription.followUpDate && (
                  <p className="text-sm font-semibold text-foreground">
                    Suggested Date: {formatDateIST(prescription.followUpDate)}
                  </p>
                )}
                {prescription.followUpRecommendation && (
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {prescription.followUpRecommendation}
                  </p>
                )}
              </div>
            )}

            {prescription.notes && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-1">
                <span className="font-bold uppercase tracking-wider text-muted-foreground">
                  Additional Clinical Notes
                </span>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {prescription.notes}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Footer Integrity Note */}
        <div className="border-t border-border/70 pt-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              Electronic outpatient prescription issued by {doctorDisplay} via Medrella Healthcare. Read-only historical medical record.
            </span>
          </div>
          <span className="font-mono shrink-0">Ref: {identity.patientCode}</span>
        </div>
      </div>
    </div>
  );
}
