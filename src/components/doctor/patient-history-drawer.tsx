"use client";

import { useEffect, useState } from "react";
import { AllergySeverity, ConditionStatus } from "@/generated/prisma/enums";
import { getPatientMedicalRecordForDoctorAction } from "@/lib/actions/prescriptions";
import {
  formatAllergyCategoryLabel,
  formatAllergySeverityLabel,
  formatConditionStatusLabel,
  formatPastEntryTypeLabel,
  type CompletePatientMedicalRecord,
  type SerializedAllergy,
} from "@/lib/medical-records";
import { formatDoctorDisplayName } from "@/lib/queue-tokens";
import { formatDateIST, formatDateTimeIST, formatSlotDateTimeRangeIST } from "@/lib/time";
import { ClinicalTimelineList } from "@/components/medical/clinical-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  Calendar,
  FileText,
  HeartPulse,
  History,
  Info,
  Pill,
  PlusCircle,
  Scissors,
  ShieldAlert,
  Stethoscope,
  User,
  Users,
} from "lucide-react";

export interface DoctorHistoryTarget {
  patientId: string;
  appointmentId?: string | null;
  fallbackName?: string;
  tokenLabel?: string | null;
  subSlotLabel?: string | null;
}

export interface DoctorPrescribeLaunchContext {
  patientId: string;
  appointmentId?: string | null;
  patientName: string;
  patientCode: string;
  ageLabel?: string | null;
  gender?: string | null;
  tokenLabel?: string | null;
  subSlotLabel?: string | null;
  allergies?: SerializedAllergy[];
}

interface PatientMedicalHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DoctorHistoryTarget | null;
  onWritePrescription?: (context: DoctorPrescribeLaunchContext) => void;
}

export function PatientMedicalHistoryDrawer({
  open,
  onOpenChange,
  target,
  onWritePrescription,
}: PatientMedicalHistoryDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl overflow-y-auto p-6 bg-background"
      >
        {open && target && (
          <PatientHistoryDrawerBody
            key={`${target.patientId}:${target.appointmentId ?? "none"}`}
            target={target}
            onWritePrescription={onWritePrescription}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PatientHistoryDrawerBody({
  target,
  onWritePrescription,
}: {
  target: DoctorHistoryTarget;
  onWritePrescription?: (context: DoctorPrescribeLaunchContext) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<CompletePatientMedicalRecord | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;

    getPatientMedicalRecordForDoctorAction({
      patientId: target.patientId,
      appointmentId: target.appointmentId ?? null,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setRecord(res.data);
        } else {
          setError(res.error ?? "Unable to load patient medical history.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to fetch patient medical history.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [target.patientId, target.appointmentId]);

  const hasSevereAllergy = Boolean(
    record?.allergies.some((a) => a.severity === AllergySeverity.SEVERE)
  );

  return (
    <>
      <SheetHeader className="p-0 pb-4 border-b border-border pr-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <SheetTitle className="text-xl font-bold flex items-center gap-2 flex-wrap">
              <User className="h-5 w-5 text-primary shrink-0" />
              <span>{record?.identity.name ?? target.fallbackName ?? "Patient"}</span>
              {record?.identity.patientCode && (
                <Badge variant="outline" className="font-mono text-xs">
                  {record.identity.patientCode}
                </Badge>
              )}
            </SheetTitle>
            <SheetDescription className="text-xs mt-1 space-y-0.5">
              <span className="block">
                {record?.identity.ageLabel
                  ? `Age: ${record.identity.ageLabel}`
                  : "Age not provided"}
                {record?.identity.dateOfBirth
                  ? ` (DOB: ${record.identity.dateOfBirth})`
                  : ""}
                {record?.identity.gender ? ` • ${record.identity.gender}` : ""}
                {record?.profile.bloodGroup
                  ? ` • Blood Group: ${record.profile.bloodGroup}`
                  : ""}
              </span>
              {(target.tokenLabel || target.subSlotLabel || record?.identity.subSlotLabel) && (
                <span className="block text-primary font-medium">
                  {target.tokenLabel ? `Queue Token ${target.tokenLabel}` : ""}
                  {target.tokenLabel && (target.subSlotLabel || record?.identity.subSlotLabel)
                    ? " • "
                    : ""}
                  {target.subSlotLabel ?? record?.identity.subSlotLabel ?? ""}
                </span>
              )}
            </SheetDescription>
          </div>

          {record && onWritePrescription && (
            <Button
              type="button"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() =>
                onWritePrescription({
                  patientId: record.identity.patientId,
                  appointmentId: target.appointmentId ?? record.identity.appointmentId ?? null,
                  patientName: record.identity.name,
                  patientCode: record.identity.patientCode,
                  ageLabel: record.identity.ageLabel,
                  gender: record.identity.gender,
                  tokenLabel: target.tokenLabel ?? null,
                  subSlotLabel: target.subSlotLabel ?? record.identity.subSlotLabel,
                  allergies: record.allergies,
                })
              }
            >
              <PlusCircle className="h-4 w-4" />
              Write Prescription
            </Button>
          )}
        </div>
      </SheetHeader>

        {loading && (
          <div className="space-y-4 py-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}

        {error && !loading && (
          <div className="my-6 rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to Open Patient History</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          </div>
        )}

        {record && !loading && (
          <div className="space-y-5 pt-4">
            {/* ALWAYS-VISIBLE PROMINENT ALLERGY SAFETY BANNER (NEVER COLLAPSED) */}
            {record.allergies.length > 0 ? (
              <div
                role="alert"
                className={`rounded-xl border p-4 space-y-2.5 ${
                  hasSevereAllergy
                    ? "border-rose-500/60 bg-rose-50 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100"
                    : "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <AlertTriangle
                      className={`h-4 w-4 shrink-0 ${
                        hasSevereAllergy ? "text-rose-600 animate-pulse" : "text-amber-600"
                      }`}
                    />
                    <span>
                      Allergy Safety Alert ({record.allergies.length} documented)
                    </span>
                  </div>
                  {hasSevereAllergy && (
                    <Badge className="bg-rose-600 text-white text-[10px] uppercase font-bold">
                      Severe Allergy Present
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {record.allergies.map((allergy) => (
                    <div
                      key={allergy.id}
                      className={`rounded-lg border p-2.5 text-xs ${
                        allergy.severity === AllergySeverity.SEVERE
                          ? "border-rose-400/60 bg-white/80 dark:bg-rose-950/60"
                          : "border-amber-400/50 bg-white/70 dark:bg-amber-950/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-foreground">{allergy.allergen}</span>
                        <div className="flex items-center gap-1">
                          <Badge
                            className={
                              allergy.severity === AllergySeverity.SEVERE
                                ? "bg-rose-600 text-white text-[10px]"
                                : allergy.severity === AllergySeverity.MODERATE
                                  ? "bg-amber-600 text-white text-[10px]"
                                  : "bg-slate-600 text-white text-[10px]"
                            }
                          >
                            {formatAllergySeverityLabel(allergy.severity)}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {formatAllergyCategoryLabel(allergy.category)}
                          </Badge>
                        </div>
                      </div>
                      {allergy.reaction && (
                        <p className="mt-1 text-foreground">
                          <strong>Reaction:</strong> {allergy.reaction}
                        </p>
                      )}
                      {allergy.notes && (
                        <p className="mt-0.5 text-muted-foreground">{allergy.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>No known allergies documented by this patient.</span>
              </div>
            )}

            {/* Empty Medical Profile Notice (without hiding Medrella consultation/Rx history) */}
            {!record.hasAnyMedicalHistory && (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
                No medical history has been added by this patient yet.
              </div>
            )}

            {/* Categorized Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start p-1 mb-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="history">Medical History</TabsTrigger>
                <TabsTrigger value="medications">Medications</TabsTrigger>
                <TabsTrigger value="consultations">
                  Consultations ({record.consultations.length})
                </TabsTrigger>
                <TabsTrigger value="prescriptions">
                  Prescriptions ({record.prescriptions.length})
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: OVERVIEW */}
              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Card className="border-border shadow-none">
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                        Profile &amp; Emergency Contact
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-1.5 text-xs">
                      <p>
                        <strong>Patient Ref:</strong>{" "}
                        <span className="font-mono">{record.identity.patientCode}</span>
                      </p>
                      <p>
                        <strong>Blood Group:</strong>{" "}
                        {record.profile.bloodGroup ?? "Not specified"}
                      </p>
                      <p>
                        <strong>Lifestyle:</strong>{" "}
                        {record.profile.lifestyleNotes ?? "Not provided"}
                      </p>
                      <p>
                        <strong>Emergency Contact:</strong>{" "}
                        {record.profile.emergencyContactName ||
                        record.profile.emergencyContactPhone
                          ? `${record.profile.emergencyContactName ?? "Contact"}${
                              record.profile.emergencyContactRelation
                                ? ` (${record.profile.emergencyContactRelation})`
                                : ""
                            } — ${record.profile.emergencyContactPhone ?? "No phone"}`
                          : "Not provided"}
                      </p>
                      {record.profile.otherMedicalNotes && (
                        <p className="pt-1 border-t border-border/60">
                          <strong>Patient Notes:</strong> {record.profile.otherMedicalNotes}
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-border shadow-none">
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                        Clinical Snapshot
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span>Ongoing Conditions:</span>
                        <strong>
                          {
                            record.conditions.filter(
                              (c) => c.status === ConditionStatus.ONGOING
                            ).length
                          }
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Patient-Reported Medications:</span>
                        <strong>{record.medications.length}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Past / Surgical / Family Items:</span>
                        <strong>
                          {record.pastMedicalEntries.length +
                            record.surgeries.length +
                            record.familyHistories.length}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>App Consultations:</span>
                        <strong>{record.consultations.length}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Issued Prescriptions:</span>
                        <strong>{record.prescriptions.length}</strong>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {record.conditions.length > 0 && (
                  <Card className="border-border shadow-none">
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-1.5">
                        <HeartPulse className="h-4 w-4 text-primary" />
                        Documented Conditions
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 flex flex-wrap gap-2">
                      {record.conditions.map((cond) => (
                        <Badge
                          key={cond.id}
                          variant={
                            cond.status === ConditionStatus.ONGOING ? "default" : "secondary"
                          }
                          className="text-xs"
                        >
                          {cond.name} ({formatConditionStatusLabel(cond.status)})
                        </Badge>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* TAB 2: COMPLETE PATIENT-PROVIDED MEDICAL HISTORY */}
              <TabsContent value="history" className="space-y-4">
                {!record.hasAnyMedicalHistory ? (
                  <p className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-xl">
                    No medical history has been added by this patient yet.
                  </p>
                ) : (
                  <>
                    {/* Existing Conditions */}
                    <SectionBlock
                      title="Existing Medical Conditions"
                      icon={<HeartPulse className="h-4 w-4 text-primary" />}
                      empty="No medical conditions reported."
                      items={record.conditions.map((c) => ({
                        id: c.id,
                        title: `${c.name} — ${formatConditionStatusLabel(c.status)}`,
                        sub: c.diagnosedDate ? `Diagnosed: ${formatDateIST(c.diagnosedDate)}` : null,
                        notes: c.notes,
                      }))}
                    />

                    {/* Past Medical History */}
                    <SectionBlock
                      title="Past Illnesses, Diagnoses, Procedures & Hospitalizations"
                      icon={<History className="h-4 w-4 text-primary" />}
                      empty="No past medical history reported."
                      items={record.pastMedicalEntries.map((p) => ({
                        id: p.id,
                        title: `${p.title} (${formatPastEntryTypeLabel(p.entryType)})`,
                        sub: [
                          p.recordedDate
                            ? formatDateIST(p.recordedDate)
                            : p.dateOrYear ?? null,
                          p.facility,
                        ]
                          .filter(Boolean)
                          .join(" • ") || null,
                        notes: p.notes,
                      }))}
                    />

                    {/* Surgical History */}
                    <SectionBlock
                      title="Surgical History"
                      icon={<Scissors className="h-4 w-4 text-primary" />}
                      empty="No surgeries reported."
                      items={record.surgeries.map((s) => ({
                        id: s.id,
                        title: s.procedureName,
                        sub: [
                          s.surgeryDate ? formatDateIST(s.surgeryDate) : s.dateOrYear ?? null,
                          s.hospitalOrClinic,
                        ]
                          .filter(Boolean)
                          .join(" • ") || null,
                        notes: s.notes,
                      }))}
                    />

                    {/* Family History */}
                    <SectionBlock
                      title="Family Medical History"
                      icon={<Users className="h-4 w-4 text-primary" />}
                      empty="No family medical history reported."
                      items={record.familyHistories.map((f) => ({
                        id: f.id,
                        title: `${f.condition} (${f.relationship})`,
                        sub: null,
                        notes: f.notes,
                      }))}
                    />

                    {/* Additional Notes */}
                    {(record.profile.lifestyleNotes || record.profile.otherMedicalNotes) && (
                      <Card className="border-border shadow-none">
                        <CardHeader className="py-3 px-4">
                          <CardTitle className="text-sm">
                            Additional Patient-Provided Notes
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 space-y-2 text-xs">
                          {record.profile.lifestyleNotes && (
                            <div>
                              <strong>Lifestyle:</strong> {record.profile.lifestyleNotes}
                            </div>
                          )}
                          {record.profile.otherMedicalNotes && (
                            <div>
                              <strong>Other Notes:</strong> {record.profile.otherMedicalNotes}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </TabsContent>

              {/* TAB 3: MEDICATIONS (PATIENT-REPORTED VS CLINIC-PRESCRIBED) */}
              <TabsContent value="medications" className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-1.5">
                      <Pill className="h-4 w-4 text-primary" />
                      Patient-Reported Current Medications
                    </h3>
                    <Badge variant="outline" className="text-[10px]">
                      Patient-Reported
                    </Badge>
                  </div>
                  {record.medications.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4 border border-dashed rounded-lg">
                      No current medications reported by patient.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {record.medications.map((m) => (
                        <div key={m.id} className="rounded-lg border border-border p-3 text-xs space-y-1">
                          <div className="font-bold text-sm text-foreground">{m.medicineName}</div>
                          <div className="text-muted-foreground">
                            {[m.dosage, m.frequency].filter(Boolean).join(" • ") ||
                              "Dosage/frequency not specified"}
                            {m.prescribedBy ? ` • Prescribed by: ${m.prescribedBy}` : ""}
                          </div>
                          {(m.startDate || m.endDate) && (
                            <div className="text-muted-foreground">
                              {m.startDate ? `Start: ${formatDateIST(m.startDate)}` : ""}
                              {m.endDate ? ` • End: ${formatDateIST(m.endDate)}` : ""}
                            </div>
                          )}
                          {m.notes && <p className="text-muted-foreground">{m.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-emerald-600" />
                      Recently Prescribed in Medrella
                    </h3>
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                      Issued Prescription
                    </Badge>
                  </div>
                  {record.prescriptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4 border border-dashed rounded-lg">
                      No prior Medrella prescriptions on file.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {record.prescriptions.slice(0, 5).map((rx) => (
                        <div key={rx.id} className="rounded-lg border border-border p-3 text-xs space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground">
                              {formatDoctorDisplayName(rx.doctorName)} — {rx.diagnosis}
                            </span>
                            <span className="text-muted-foreground">
                              {formatDateIST(rx.prescribedAt)}
                            </span>
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                            {rx.medicines.map((med) => (
                              <li key={med.id}>
                                <strong className="text-foreground">{med.medicineName}</strong> ({med.dosage}) — {med.frequency} for {med.duration}
                                {med.instructions ? ` • ${med.instructions}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* TAB 4: CONSULTATIONS & TIMELINE */}
              <TabsContent value="consultations" className="space-y-5">
                <div className="space-y-2.5">
                  <h3 className="text-sm font-bold flex items-center gap-1.5">
                    <Stethoscope className="h-4 w-4 text-primary" />
                    Appointment &amp; Consultation History ({record.consultations.length})
                  </h3>
                  {record.consultations.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4 border border-dashed rounded-lg">
                      No previous consultations recorded.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {record.consultations.map((c) => (
                        <div key={c.id} className="rounded-lg border border-border p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-bold text-foreground">
                              {formatDoctorDisplayName(c.doctorName)} ({c.doctorSpecialization})
                            </span>
                            <div className="flex items-center gap-1.5">
                              {typeof c.tokenNumber === "number" && (
                                <Badge variant="outline" className="text-[10px]">
                                  Token #{c.tokenNumber}
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-[10px]">
                                {c.statusLabel}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatSlotDateTimeRangeIST(c.slotStart, c.slotEnd)} IST ({c.subSlotLabel})
                          </p>
                          {c.diagnoses.length > 0 && (
                            <p className="text-foreground">
                              <strong>Recorded Diagnosis:</strong> {c.diagnoses.join("; ")}
                            </p>
                          )}
                          {c.reason && (
                            <p className="text-muted-foreground">
                              <strong>Patient Reason:</strong> {c.reason}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2.5 pt-2 border-t border-border">
                  <h3 className="text-sm font-bold">Unified Chronological Timeline</h3>
                  <ClinicalTimelineList events={record.timeline} />
                </div>
              </TabsContent>

              {/* TAB 5: PREVIOUS PRESCRIPTIONS */}
              <TabsContent value="prescriptions" className="space-y-3">
                {record.prescriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-xl">
                    No prescriptions issued for this patient yet.
                  </p>
                ) : (
                  record.prescriptions.map((rx) => (
                    <Card key={rx.id} className="border-border shadow-none">
                      <CardContent className="p-4 space-y-2.5 text-xs">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div>
                            <p className="font-bold text-sm text-foreground">
                              {formatDoctorDisplayName(rx.doctorName)}
                              {rx.doctorSpecialization ? ` • ${rx.doctorSpecialization}` : ""}
                            </p>
                            <p className="text-muted-foreground">
                              Issued: {formatDateTimeIST(rx.prescribedAt)} IST
                              {rx.appointmentSummary?.tokenNumber
                                ? ` • Token #${rx.appointmentSummary.tokenNumber}`
                                : ""}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            Rx {rx.id.slice(-6).toUpperCase()}
                          </Badge>
                        </div>

                        <div className="rounded-md bg-primary/5 border border-primary/20 p-2.5">
                          <strong className="text-primary">Diagnosis: </strong>
                          <span className="text-foreground font-medium">{rx.diagnosis}</span>
                        </div>

                        <div className="border border-border/60 rounded-lg overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-muted/40 border-b border-border/60 text-[10px] uppercase text-muted-foreground">
                              <tr>
                                <th className="py-1.5 px-2.5">Medicine</th>
                                <th className="py-1.5 px-2.5">Dosage</th>
                                <th className="py-1.5 px-2.5">Frequency</th>
                                <th className="py-1.5 px-2.5">Duration</th>
                                <th className="py-1.5 px-2.5">Instructions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {rx.medicines.map((med) => (
                                <tr key={med.id}>
                                  <td className="py-2 px-2.5 font-semibold text-foreground">
                                    {med.medicineName}
                                    {med.route ? ` (${med.route})` : ""}
                                  </td>
                                  <td className="py-2 px-2.5">{med.dosage}</td>
                                  <td className="py-2 px-2.5">{med.frequency}</td>
                                  <td className="py-2 px-2.5">{med.duration}</td>
                                  <td className="py-2 px-2.5 text-muted-foreground">
                                    {med.instructions ?? "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {(rx.generalInstructions ||
                          rx.lifestyleAdvice ||
                          rx.followUpRecommendation ||
                          rx.followUpDate) && (
                          <div className="text-muted-foreground space-y-0.5 pt-1">
                            {rx.generalInstructions && (
                              <p>
                                <strong className="text-foreground">General:</strong>{" "}
                                {rx.generalInstructions}
                              </p>
                            )}
                            {rx.lifestyleAdvice && (
                              <p>
                                <strong className="text-foreground">Lifestyle:</strong>{" "}
                                {rx.lifestyleAdvice}
                              </p>
                            )}
                            {(rx.followUpRecommendation || rx.followUpDate) && (
                              <p>
                                <strong className="text-foreground">Follow-up:</strong>{" "}
                                {rx.followUpDate ? `${formatDateIST(rx.followUpDate)} ` : ""}
                                {rx.followUpRecommendation ?? ""}
                              </p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
    </>
  );
}

function SectionBlock(props: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  items: Array<{ id: string; title: string; sub: string | null; notes: string | null }>;
}) {
  return (
    <Card className="border-border shadow-none">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-1.5">
          {props.icon}
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {props.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{props.empty}</p>
        ) : (
          props.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border/70 p-2.5 text-xs space-y-0.5">
              <div className="font-semibold text-foreground">{item.title}</div>
              {item.sub && <div className="text-muted-foreground">{item.sub}</div>}
              {item.notes && <div className="text-muted-foreground">{item.notes}</div>}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
