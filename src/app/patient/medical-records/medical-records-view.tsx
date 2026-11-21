"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AllergyCategory,
  AllergySeverity,
  ConditionStatus,
  PastMedicalEntryType,
} from "@/generated/prisma/enums";
import {
  deletePatientAllergyAction,
  deletePatientConditionAction,
  deletePatientFamilyHistoryAction,
  deletePatientMedicationAction,
  deletePatientPastMedicalEntryAction,
  deletePatientSurgeryAction,
  savePatientAllergyAction,
  savePatientConditionAction,
  savePatientFamilyHistoryAction,
  savePatientMedicationAction,
  savePatientPastMedicalEntryAction,
  savePatientSurgeryAction,
  upsertPatientMedicalProfileAction,
} from "@/lib/actions/medical-records";
import {
  formatAllergyCategoryLabel,
  formatAllergySeverityLabel,
  formatConditionStatusLabel,
  formatPastEntryTypeLabel,
  type CompletePatientMedicalRecord,
  type SerializedAllergy,
  type SerializedCondition,
  type SerializedFamilyHistory,
  type SerializedMedication,
  type SerializedPastMedicalEntry,
  type SerializedSurgery,
} from "@/lib/medical-records";
import {
  BLOOD_GROUP_OPTIONS,
  FAMILY_RELATIONSHIP_OPTIONS,
} from "@/lib/validations/medical-records";
import { formatDoctorDisplayName } from "@/lib/queue-tokens";
import { formatDateIST, formatDateTimeIST, formatSlotDateTimeRangeIST } from "@/lib/time";
import { ClinicalTimelineList } from "@/components/medical/clinical-timeline";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calendar,
  FileText,
  HeartPulse,
  History,
  Pencil,
  Phone,
  Pill,
  Plus,
  Printer,
  Scissors,
  ShieldCheck,
  Trash2,
  User,
  Users,
} from "lucide-react";

interface MedicalRecordsViewProps {
  record: CompletePatientMedicalRecord;
  initialTab?: string;
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function MedicalRecordsView({
  record,
  initialTab = "overview",
}: MedicalRecordsViewProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isPending, startTransition] = useTransition();

  // Section G: Medical Profile Overview State
  const [bloodGroup, setBloodGroup] = useState(record.profile.bloodGroup ?? "");
  const [lifestyleNotes, setLifestyleNotes] = useState(record.profile.lifestyleNotes ?? "");
  const [otherMedicalNotes, setOtherMedicalNotes] = useState(record.profile.otherMedicalNotes ?? "");
  const [emergencyContactName, setEmergencyContactName] = useState(
    record.profile.emergencyContactName ?? ""
  );
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(
    record.profile.emergencyContactPhone ?? ""
  );
  const [emergencyContactRelation, setEmergencyContactRelation] = useState(
    record.profile.emergencyContactRelation ?? ""
  );

  // Dialog states
  const [allergyOpen, setAllergyOpen] = useState(false);
  const [allergyEditingId, setAllergyEditingId] = useState<string | undefined>();
  const [allergyCategory, setAllergyCategory] = useState<AllergyCategory>(
    AllergyCategory.MEDICINE
  );
  const [allergyAllergen, setAllergyAllergen] = useState("");
  const [allergyReaction, setAllergyReaction] = useState("");
  const [allergySeverity, setAllergySeverity] = useState<AllergySeverity>(
    AllergySeverity.MODERATE
  );
  const [allergyNotes, setAllergyNotes] = useState("");

  const [conditionOpen, setConditionOpen] = useState(false);
  const [conditionEditingId, setConditionEditingId] = useState<string | undefined>();
  const [conditionName, setConditionName] = useState("");
  const [conditionDate, setConditionDate] = useState("");
  const [conditionStatus, setConditionStatus] = useState<ConditionStatus>(
    ConditionStatus.ONGOING
  );
  const [conditionNotes, setConditionNotes] = useState("");

  const [medOpen, setMedOpen] = useState(false);
  const [medEditingId, setMedEditingId] = useState<string | undefined>();
  const [medName, setMedName] = useState("");
  const [medDosage, setMedDosage] = useState("");
  const [medFrequency, setMedFrequency] = useState("");
  const [medStartDate, setMedStartDate] = useState("");
  const [medEndDate, setMedEndDate] = useState("");
  const [medPrescribedBy, setMedPrescribedBy] = useState("");
  const [medNotes, setMedNotes] = useState("");

  const [pastOpen, setPastOpen] = useState(false);
  const [pastEditingId, setPastEditingId] = useState<string | undefined>();
  const [pastType, setPastType] = useState<PastMedicalEntryType>(
    PastMedicalEntryType.ILLNESS
  );
  const [pastTitle, setPastTitle] = useState("");
  const [pastDateOrYear, setPastDateOrYear] = useState("");
  const [pastRecordedDate, setPastRecordedDate] = useState("");
  const [pastFacility, setPastFacility] = useState("");
  const [pastNotes, setPastNotes] = useState("");

  const [surgeryOpen, setSurgeryOpen] = useState(false);
  const [surgeryEditingId, setSurgeryEditingId] = useState<string | undefined>();
  const [surgeryName, setSurgeryName] = useState("");
  const [surgeryDateOrYear, setSurgeryDateOrYear] = useState("");
  const [surgeryDate, setSurgeryDate] = useState("");
  const [surgeryHospital, setSurgeryHospital] = useState("");
  const [surgeryNotes, setSurgeryNotes] = useState("");

  const [familyOpen, setFamilyOpen] = useState(false);
  const [familyEditingId, setFamilyEditingId] = useState<string | undefined>();
  const [familyCondition, setFamilyCondition] = useState("");
  const [familyRelationship, setFamilyRelationship] = useState("Father");
  const [familyNotes, setFamilyNotes] = useState("");

  // Confirm delete modal
  const [deleteTarget, setDeleteTarget] = useState<{
    label: string;
    onConfirm: () => Promise<{ success: boolean; message?: string; error?: string }>;
  } | null>(null);

  const runAction = (
    fn: () => Promise<{ success: boolean; message?: string; error?: string }>,
    onSuccess?: () => void
  ) => {
    startTransition(async () => {
      const res = await fn();
      if (res.success) {
        toast.success(res.message ?? "Saved.");
        onSuccess?.();
        router.refresh();
      } else {
        toast.error(res.error ?? "Unable to save changes.");
      }
    });
  };

  const openAllergyModal = (item?: SerializedAllergy) => {
    setAllergyEditingId(item?.id);
    setAllergyCategory(item?.category ?? AllergyCategory.MEDICINE);
    setAllergyAllergen(item?.allergen ?? "");
    setAllergyReaction(item?.reaction ?? "");
    setAllergySeverity(item?.severity ?? AllergySeverity.MODERATE);
    setAllergyNotes(item?.notes ?? "");
    setAllergyOpen(true);
  };

  const openConditionModal = (item?: SerializedCondition) => {
    setConditionEditingId(item?.id);
    setConditionName(item?.name ?? "");
    setConditionDate(toDateInputValue(item?.diagnosedDate));
    setConditionStatus(item?.status ?? ConditionStatus.ONGOING);
    setConditionNotes(item?.notes ?? "");
    setConditionOpen(true);
  };

  const openMedicationModal = (item?: SerializedMedication) => {
    setMedEditingId(item?.id);
    setMedName(item?.medicineName ?? "");
    setMedDosage(item?.dosage ?? "");
    setMedFrequency(item?.frequency ?? "");
    setMedStartDate(toDateInputValue(item?.startDate));
    setMedEndDate(toDateInputValue(item?.endDate));
    setMedPrescribedBy(item?.prescribedBy ?? "");
    setMedNotes(item?.notes ?? "");
    setMedOpen(true);
  };

  const openPastModal = (item?: SerializedPastMedicalEntry) => {
    setPastEditingId(item?.id);
    setPastType(item?.entryType ?? PastMedicalEntryType.ILLNESS);
    setPastTitle(item?.title ?? "");
    setPastDateOrYear(item?.dateOrYear ?? "");
    setPastRecordedDate(toDateInputValue(item?.recordedDate));
    setPastFacility(item?.facility ?? "");
    setPastNotes(item?.notes ?? "");
    setPastOpen(true);
  };

  const openSurgeryModal = (item?: SerializedSurgery) => {
    setSurgeryEditingId(item?.id);
    setSurgeryName(item?.procedureName ?? "");
    setSurgeryDateOrYear(item?.dateOrYear ?? "");
    setSurgeryDate(toDateInputValue(item?.surgeryDate));
    setSurgeryHospital(item?.hospitalOrClinic ?? "");
    setSurgeryNotes(item?.notes ?? "");
    setSurgeryOpen(true);
  };

  const openFamilyModal = (item?: SerializedFamilyHistory) => {
    setFamilyEditingId(item?.id);
    setFamilyCondition(item?.condition ?? "");
    setFamilyRelationship(item?.relationship ?? "Father");
    setFamilyNotes(item?.notes ?? "");
    setFamilyOpen(true);
  };

  const allergySeverityBadge = (severity: AllergySeverity) => {
    const label = formatAllergySeverityLabel(severity);
    if (severity === AllergySeverity.SEVERE) {
      return (
        <Badge className="bg-rose-600 text-white text-[10px] uppercase font-bold">
          {label}
        </Badge>
      );
    }
    if (severity === AllergySeverity.MODERATE) {
      return (
        <Badge className="bg-amber-600 text-white text-[10px] uppercase font-semibold">
          {label}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-[10px] uppercase font-semibold">
        {label}
      </Badge>
    );
  };

  const severeAllergiesCount = record.allergies.filter(
    (a) => a.severity === AllergySeverity.SEVERE
  ).length;

  return (
    <div className="space-y-6">
      {/* Patient Identity Strip & Quick Health Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-border shadow-xs">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs flex items-center gap-1">
              <User className="h-3.5 w-3.5 text-primary" />
              Patient Reference
            </CardDescription>
            <CardTitle className="text-lg font-bold text-foreground font-mono">
              {record.identity.patientCode}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              {record.identity.ageLabel ?? "Age N/A"}
              {record.identity.gender ? ` • ${record.identity.gender}` : ""}
              {record.profile.bloodGroup ? ` • Blood: ${record.profile.bloodGroup}` : ""}
            </p>
          </CardHeader>
        </Card>

        <Card
          className={`shadow-xs ${
            severeAllergiesCount > 0 ? "border-rose-500/40 bg-rose-50/30 dark:bg-rose-950/15" : "border-border"
          }`}
        >
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
              Documented Allergies
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {record.allergies.length}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              {severeAllergiesCount > 0
                ? `${severeAllergiesCount} severe allergy alert(s)`
                : "Medicine, food & environmental"}
            </p>
          </CardHeader>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs flex items-center gap-1">
              <HeartPulse className="h-3.5 w-3.5 text-primary" />
              Conditions &amp; Medications
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {record.conditions.length} / {record.medications.length}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Conditions / Active meds logged
            </p>
          </CardHeader>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs flex items-center gap-1">
              <Pill className="h-3.5 w-3.5 text-emerald-600" />
              Issued Prescriptions
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {record.prescriptions.length}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Verified outpatient Rx history
            </p>
          </CardHeader>
        </Card>
      </div>

      {/* Main Categorized Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start p-1.5 mb-6">
          <TabsTrigger value="overview">Overview &amp; Info</TabsTrigger>
          <TabsTrigger value="allergies">Allergies ({record.allergies.length})</TabsTrigger>
          <TabsTrigger value="conditions">Conditions ({record.conditions.length})</TabsTrigger>
          <TabsTrigger value="medications">Medications ({record.medications.length})</TabsTrigger>
          <TabsTrigger value="history">
            Past, Surgical &amp; Family (
            {record.pastMedicalEntries.length +
              record.surgeries.length +
              record.familyHistories.length}
            )
          </TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({record.timeline.length})</TabsTrigger>
          <TabsTrigger value="prescriptions">
            Prescriptions ({record.prescriptions.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: OVERVIEW & ADDITIONAL INFORMATION */}
        <TabsContent value="overview" className="space-y-6">
          {!record.hasAnyMedicalHistory && (
            <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-5 text-sm text-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Your medical profile is currently empty.</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All fields are optional — start by adding allergies, ongoing conditions, current medications, or additional details below as you go.
                </p>
              </div>
              <Button size="sm" onClick={() => openAllergyModal()} className="gap-1.5 shrink-0">
                <Plus className="h-4 w-4" />
                Add Allergy
              </Button>
            </div>
          )}

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Additional Medical Information &amp; Emergency Contact</CardTitle>
              <CardDescription className="text-xs">
                Optional background notes shared with your consulting doctors during visits. You can save partial information and update anytime.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="bloodGroup">Blood Group (Optional)</Label>
                  <select
                    id="bloodGroup"
                    value={bloodGroup}
                    onChange={(e) => setBloodGroup(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Not specified</option>
                    {BLOOD_GROUP_OPTIONS.map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="emergencyRelation">Emergency Contact Relationship</Label>
                  <Input
                    id="emergencyRelation"
                    value={emergencyContactRelation}
                    onChange={(e) => setEmergencyContactRelation(e.target.value)}
                    placeholder="e.g., Spouse, Parent, Sibling"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="emergencyName">Emergency Contact Name</Label>
                  <Input
                    id="emergencyName"
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                    placeholder="Full name of emergency contact"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="emergencyPhone">Emergency Contact Phone</Label>
                  <Input
                    id="emergencyPhone"
                    value={emergencyContactPhone}
                    onChange={(e) => setEmergencyContactPhone(e.target.value)}
                    placeholder="e.g., +91 98765 43210"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lifestyleNotes">Lifestyle &amp; Habits (Optional)</Label>
                <Textarea
                  id="lifestyleNotes"
                  value={lifestyleNotes}
                  onChange={(e) => setLifestyleNotes(e.target.value)}
                  placeholder="Medically relevant lifestyle context (e.g., smoking/alcohol history, dietary pattern, sleep, exercise)"
                  rows={3}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="otherMedicalNotes">Other Medical Notes (Optional)</Label>
                <Textarea
                  id="otherMedicalNotes"
                  value={otherMedicalNotes}
                  onChange={(e) => setOtherMedicalNotes(e.target.value)}
                  placeholder="Any implants, mobility assistance, donor status, or notes for your doctor"
                  rows={3}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    runAction(() =>
                      upsertPatientMedicalProfileAction({
                        bloodGroup: bloodGroup || null,
                        lifestyleNotes: lifestyleNotes || null,
                        otherMedicalNotes: otherMedicalNotes || null,
                        emergencyContactName: emergencyContactName || null,
                        emergencyContactPhone: emergencyContactPhone || null,
                        emergencyContactRelation: emergencyContactRelation || null,
                      })
                    )
                  }
                >
                  {isPending ? "Saving..." : "Save Medical Overview"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: ALLERGIES */}
        <TabsContent value="allergies" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Allergies</h2>
              <p className="text-xs text-muted-foreground">
                Document drug, food, environmental, or other allergies so doctors see prominent warnings before prescribing.
              </p>
            </div>
            <Button size="sm" onClick={() => openAllergyModal()} className="gap-1.5 self-start">
              <Plus className="h-4 w-4" />
              Add Allergy
            </Button>
          </div>

          {record.allergies.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="p-10 text-center text-muted-foreground text-sm">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-35" />
                No allergies added yet. Add any medicine, food, or environmental reactions if applicable.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {record.allergies.map((item) => (
                <Card
                  key={item.id}
                  className={
                    item.severity === AllergySeverity.SEVERE
                      ? "border-rose-500/40 bg-rose-50/20 dark:bg-rose-950/15"
                      : "border-border"
                  }
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-foreground">{item.allergen}</span>
                          {allergySeverityBadge(item.severity)}
                          <Badge variant="outline" className="text-[10px]">
                            {formatAllergyCategoryLabel(item.category)}
                          </Badge>
                        </div>
                        {item.reaction && (
                          <p className="text-xs text-foreground mt-1">
                            <strong>Reaction:</strong> {item.reaction}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-xs text-muted-foreground mt-1">{item.notes}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit allergy ${item.allergen}`}
                          onClick={() => openAllergyModal(item)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Remove allergy ${item.allergen}`}
                          onClick={() =>
                            setDeleteTarget({
                              label: `Remove allergy "${item.allergen}"?`,
                              onConfirm: () => deletePatientAllergyAction(item.id),
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 3: EXISTING MEDICAL CONDITIONS */}
        <TabsContent value="conditions" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Existing Medical Conditions</h2>
              <p className="text-xs text-muted-foreground">
                Track ongoing or resolved chronic conditions and diagnoses.
              </p>
            </div>
            <Button size="sm" onClick={() => openConditionModal()} className="gap-1.5 self-start">
              <Plus className="h-4 w-4" />
              Add Condition
            </Button>
          </div>

          {record.conditions.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="p-10 text-center text-muted-foreground text-sm">
                <HeartPulse className="h-8 w-8 mx-auto mb-2 opacity-35" />
                No medical conditions recorded yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {record.conditions.map((item) => (
                <Card key={item.id} className="border-border">
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground">{item.name}</span>
                        <Badge
                          className={
                            item.status === ConditionStatus.ONGOING
                              ? "bg-blue-600 text-white text-[10px]"
                              : "bg-emerald-600 text-white text-[10px]"
                          }
                        >
                          {formatConditionStatusLabel(item.status)}
                        </Badge>
                      </div>
                      {item.diagnosedDate && (
                        <p className="text-xs text-muted-foreground">
                          Diagnosed: {formatDateIST(item.diagnosedDate)}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-xs text-muted-foreground">{item.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit condition ${item.name}`}
                        onClick={() => openConditionModal(item)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Remove condition ${item.name}`}
                        onClick={() =>
                          setDeleteTarget({
                            label: `Remove condition "${item.name}"?`,
                            onConfirm: () => deletePatientConditionAction(item.id),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 4: CURRENT MEDICATIONS */}
        <TabsContent value="medications" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Current Medications</h2>
              <p className="text-xs text-muted-foreground">
                Log medicines or supplements you are currently taking (separate from clinic prescriptions issued inside Medrella).
              </p>
            </div>
            <Button size="sm" onClick={() => openMedicationModal()} className="gap-1.5 self-start">
              <Plus className="h-4 w-4" />
              Add Medication
            </Button>
          </div>

          {record.medications.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="p-10 text-center text-muted-foreground text-sm">
                <Pill className="h-8 w-8 mx-auto mb-2 opacity-35" />
                No current medications recorded yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {record.medications.map((item) => (
                <Card key={item.id} className="border-border">
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground">{item.medicineName}</span>
                        {item.dosage && (
                          <Badge variant="outline" className="text-[10px]">
                            {item.dosage}
                          </Badge>
                        )}
                        {item.frequency && (
                          <Badge variant="secondary" className="text-[10px]">
                            {item.frequency}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                        {item.startDate && <span>Started: {formatDateIST(item.startDate)}</span>}
                        {item.endDate && <span>• End: {formatDateIST(item.endDate)}</span>}
                        {item.prescribedBy && <span>• Prescribed by: {item.prescribedBy}</span>}
                      </div>
                      {item.notes && (
                        <p className="text-xs text-muted-foreground">{item.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit medication ${item.medicineName}`}
                        onClick={() => openMedicationModal(item)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Remove medication ${item.medicineName}`}
                        onClick={() =>
                          setDeleteTarget({
                            label: `Remove medication "${item.medicineName}"?`,
                            onConfirm: () => deletePatientMedicationAction(item.id),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 5: PAST MEDICAL HISTORY, SURGICAL HISTORY & FAMILY HISTORY */}
        <TabsContent value="history" className="space-y-6">
          {/* D. Past Medical History */}
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  Past Medical History
                </CardTitle>
                <CardDescription className="text-xs">
                  Previous illnesses, relevant past diagnoses, procedures, and hospitalizations.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => openPastModal()} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add Entry
              </Button>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {record.pastMedicalEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                  No past medical history entries added yet.
                </p>
              ) : (
                record.pastMedicalEntries.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{item.title}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {formatPastEntryTypeLabel(item.entryType)}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                        {item.recordedDate && <span>Date: {formatDateIST(item.recordedDate)}</span>}
                        {!item.recordedDate && item.dateOrYear && <span>When: {item.dateOrYear}</span>}
                        {item.facility && <span>• Facility: {item.facility}</span>}
                      </div>
                      {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon-sm" onClick={() => openPastModal(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          setDeleteTarget({
                            label: `Remove past medical record "${item.title}"?`,
                            onConfirm: () => deletePatientPastMedicalEntryAction(item.id),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* E. Surgical History */}
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-primary" />
                  Surgical History
                </CardTitle>
                <CardDescription className="text-xs">
                  Surgeries and operative procedures with year/date and hospital details.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => openSurgeryModal()} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add Surgery
              </Button>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {record.surgeries.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                  No surgical history recorded yet.
                </p>
              ) : (
                record.surgeries.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="space-y-0.5">
                      <span className="font-semibold text-sm text-foreground">{item.procedureName}</span>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                        {item.surgeryDate && <span>Date: {formatDateIST(item.surgeryDate)}</span>}
                        {!item.surgeryDate && item.dateOrYear && <span>Year/Date: {item.dateOrYear}</span>}
                        {item.hospitalOrClinic && <span>• {item.hospitalOrClinic}</span>}
                      </div>
                      {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon-sm" onClick={() => openSurgeryModal(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          setDeleteTarget({
                            label: `Remove surgery "${item.procedureName}"?`,
                            onConfirm: () => deletePatientSurgeryAction(item.id),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* F. Family Medical History */}
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Family Medical History
                </CardTitle>
                <CardDescription className="text-xs">
                  Hereditary or family conditions across immediate and extended relatives.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => openFamilyModal()} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add Family History
              </Button>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {record.familyHistories.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                  No family medical history added yet.
                </p>
              ) : (
                record.familyHistories.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{item.condition}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {item.relationship}
                        </Badge>
                      </div>
                      {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon-sm" onClick={() => openFamilyModal(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          setDeleteTarget({
                            label: `Remove family history entry "${item.condition}"?`,
                            onConfirm: () => deletePatientFamilyHistoryAction(item.id),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 6: CHRONOLOGICAL CLINICAL TIMELINE */}
        <TabsContent value="timeline" className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-foreground">Medical History &amp; Consultation Timeline</h2>
            <p className="text-xs text-muted-foreground">
              Chronological record distinguishing patient-reported entries, clinic consultations, and doctor-issued prescriptions.
            </p>
          </div>
          <ClinicalTimelineList
            events={record.timeline}
            emptyMessage="Your chronological medical timeline will populate as you add medical history or complete consultations."
          />
        </TabsContent>

        {/* TAB 7: DOCTOR-ISSUED PRESCRIPTIONS (READ-ONLY) */}
        <TabsContent value="prescriptions" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-foreground">My Prescriptions</h2>
              <p className="text-xs text-muted-foreground">
                Verified outpatient prescriptions issued by Medrella doctors. Prescriptions are preserved read-only and remain unaffected by profile edits.
              </p>
            </div>
            <Badge variant="outline" className="text-xs gap-1 self-start">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Read-Only Clinical Record
            </Badge>
          </div>

          {record.prescriptions.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="p-10 text-center text-muted-foreground text-sm">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-35" />
                No prescriptions have been issued for your consultations yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {record.prescriptions.map((rx) => (
                <Card key={rx.id} className="border-border shadow-xs">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-base text-foreground">
                            {formatDoctorDisplayName(rx.doctorName)}
                          </span>
                          {rx.doctorSpecialization && (
                            <Badge variant="outline" className="text-[11px]">
                              {rx.doctorSpecialization}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Issued: {formatDateTimeIST(rx.prescribedAt)} IST
                          </span>
                          {rx.appointmentSummary && (
                            <span>
                              • Consultation:{" "}
                              {formatSlotDateTimeRangeIST(
                                rx.appointmentSummary.slotStart,
                                rx.appointmentSummary.slotEnd
                              )}
                              {typeof rx.appointmentSummary.tokenNumber === "number"
                                ? ` (Token #${rx.appointmentSummary.tokenNumber})`
                                : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      <Link
                        href={`/patient/prescriptions/${rx.id}`}
                        className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1.5 shrink-0" })}
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Open / Print Rx
                      </Link>
                    </div>

                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-primary block">
                        Diagnosis
                      </span>
                      <span className="font-medium text-foreground">{rx.diagnosis}</span>
                    </div>

                    <div className="border border-border/70 rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/50 border-b border-border/70 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="py-2 px-3">Medicine</th>
                            <th className="py-2 px-3">Dosage</th>
                            <th className="py-2 px-3">Frequency</th>
                            <th className="py-2 px-3">Duration</th>
                            <th className="py-2 px-3">Instructions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {rx.medicines.map((med) => (
                            <tr key={med.id}>
                              <td className="py-2.5 px-3 font-semibold text-foreground">
                                {med.medicineName}
                                {med.route ? ` (${med.route})` : ""}
                              </td>
                              <td className="py-2.5 px-3">{med.dosage}</td>
                              <td className="py-2.5 px-3">{med.frequency}</td>
                              <td className="py-2.5 px-3">{med.duration}</td>
                              <td className="py-2.5 px-3 text-muted-foreground">
                                {med.instructions ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {(rx.followUpRecommendation || rx.followUpDate || rx.generalInstructions) && (
                      <div className="text-xs text-muted-foreground space-y-1 bg-muted/20 p-3 rounded-lg border border-border/50">
                        {rx.generalInstructions && (
                          <p>
                            <strong className="text-foreground">Instructions:</strong>{" "}
                            {rx.generalInstructions}
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
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* DIALOG: ALLERGY ADD / EDIT */}
      <Dialog open={allergyOpen} onOpenChange={setAllergyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{allergyEditingId ? "Edit Allergy" : "Add Allergy"}</DialogTitle>
            <DialogDescription>
              Record any medication, food, environmental, or other allergies.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="allergyCategory">Category</Label>
                <select
                  id="allergyCategory"
                  value={allergyCategory}
                  onChange={(e) => setAllergyCategory(e.target.value as AllergyCategory)}
                  className={SELECT_CLASS}
                >
                  <option value={AllergyCategory.MEDICINE}>Medicine</option>
                  <option value={AllergyCategory.FOOD}>Food</option>
                  <option value={AllergyCategory.ENVIRONMENTAL}>Environmental</option>
                  <option value={AllergyCategory.OTHER}>Other</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="allergySeverity">Severity</Label>
                <select
                  id="allergySeverity"
                  value={allergySeverity}
                  onChange={(e) => setAllergySeverity(e.target.value as AllergySeverity)}
                  className={SELECT_CLASS}
                >
                  <option value={AllergySeverity.MILD}>Mild</option>
                  <option value={AllergySeverity.MODERATE}>Moderate</option>
                  <option value={AllergySeverity.SEVERE}>Severe</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="allergyAllergen">Specific Allergen *</Label>
              <Input
                id="allergyAllergen"
                value={allergyAllergen}
                onChange={(e) => setAllergyAllergen(e.target.value)}
                placeholder="e.g., Penicillin, Peanuts, Pollen"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="allergyReaction">Reaction Experienced (Optional)</Label>
              <Input
                id="allergyReaction"
                value={allergyReaction}
                onChange={(e) => setAllergyReaction(e.target.value)}
                placeholder="e.g., Hives, swelling, shortness of breath"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="allergyNotes">Additional Notes (Optional)</Label>
              <Textarea
                id="allergyNotes"
                value={allergyNotes}
                onChange={(e) => setAllergyNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllergyOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !allergyAllergen.trim()}
              onClick={() =>
                runAction(
                  () =>
                    savePatientAllergyAction({
                      id: allergyEditingId,
                      category: allergyCategory,
                      allergen: allergyAllergen,
                      reaction: allergyReaction || null,
                      severity: allergySeverity,
                      notes: allergyNotes || null,
                    }),
                  () => setAllergyOpen(false)
                )
              }
            >
              {isPending ? "Saving..." : "Save Allergy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: CONDITION ADD / EDIT */}
      <Dialog open={conditionOpen} onOpenChange={setConditionOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{conditionEditingId ? "Edit Condition" : "Add Medical Condition"}</DialogTitle>
            <DialogDescription>
              Add an ongoing or previously resolved medical diagnosis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="conditionName">Condition / Diagnosis Name *</Label>
              <Input
                id="conditionName"
                value={conditionName}
                onChange={(e) => setConditionName(e.target.value)}
                placeholder="e.g., Type 2 Diabetes, Hypertension, Asthma"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="conditionStatus">Status</Label>
                <select
                  id="conditionStatus"
                  value={conditionStatus}
                  onChange={(e) => setConditionStatus(e.target.value as ConditionStatus)}
                  className={SELECT_CLASS}
                >
                  <option value={ConditionStatus.ONGOING}>Ongoing</option>
                  <option value={ConditionStatus.RESOLVED}>Resolved</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conditionDate">Date Diagnosed (Optional)</Label>
                <Input
                  id="conditionDate"
                  type="date"
                  value={conditionDate}
                  onChange={(e) => setConditionDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conditionNotes">Additional Notes (Optional)</Label>
              <Textarea
                id="conditionNotes"
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConditionOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !conditionName.trim()}
              onClick={() =>
                runAction(
                  () =>
                    savePatientConditionAction({
                      id: conditionEditingId,
                      name: conditionName,
                      diagnosedDate: conditionDate || null,
                      status: conditionStatus,
                      notes: conditionNotes || null,
                    }),
                  () => setConditionOpen(false)
                )
              }
            >
              {isPending ? "Saving..." : "Save Condition"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: MEDICATION ADD / EDIT */}
      <Dialog open={medOpen} onOpenChange={setMedOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{medEditingId ? "Edit Medication" : "Add Current Medication"}</DialogTitle>
            <DialogDescription>
              Keep a list of medicines you are currently taking or recently finished.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="medName">Medicine Name *</Label>
              <Input
                id="medName"
                value={medName}
                onChange={(e) => setMedName(e.target.value)}
                placeholder="e.g., Metformin, Amlodipine"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="medDosage">Dosage (Optional)</Label>
                <Input
                  id="medDosage"
                  value={medDosage}
                  onChange={(e) => setMedDosage(e.target.value)}
                  placeholder="e.g., 500 mg"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="medFrequency">Frequency (Optional)</Label>
                <Input
                  id="medFrequency"
                  value={medFrequency}
                  onChange={(e) => setMedFrequency(e.target.value)}
                  placeholder="e.g., Once daily after dinner"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="medStartDate">Start Date (Optional)</Label>
                <Input
                  id="medStartDate"
                  type="date"
                  value={medStartDate}
                  onChange={(e) => setMedStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="medEndDate">End Date (Optional)</Label>
                <Input
                  id="medEndDate"
                  type="date"
                  value={medEndDate}
                  onChange={(e) => setMedEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="medPrescribedBy">Prescribed By (Optional)</Label>
              <Input
                id="medPrescribedBy"
                value={medPrescribedBy}
                onChange={(e) => setMedPrescribedBy(e.target.value)}
                placeholder="Doctor / clinic name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="medNotes">Additional Notes (Optional)</Label>
              <Textarea
                id="medNotes"
                value={medNotes}
                onChange={(e) => setMedNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMedOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !medName.trim()}
              onClick={() =>
                runAction(
                  () =>
                    savePatientMedicationAction({
                      id: medEditingId,
                      medicineName: medName,
                      dosage: medDosage || null,
                      frequency: medFrequency || null,
                      startDate: medStartDate || null,
                      endDate: medEndDate || null,
                      prescribedBy: medPrescribedBy || null,
                      notes: medNotes || null,
                    }),
                  () => setMedOpen(false)
                )
              }
            >
              {isPending ? "Saving..." : "Save Medication"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: PAST MEDICAL ENTRY ADD / EDIT */}
      <Dialog open={pastOpen} onOpenChange={setPastOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{pastEditingId ? "Edit Past Medical Entry" : "Add Past Medical Entry"}</DialogTitle>
            <DialogDescription>
              Log a previous illness, past diagnosis, medical procedure, or hospitalization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pastType">Entry Category</Label>
              <select
                id="pastType"
                value={pastType}
                onChange={(e) => setPastType(e.target.value as PastMedicalEntryType)}
                className={SELECT_CLASS}
              >
                <option value={PastMedicalEntryType.ILLNESS}>Previous Illness</option>
                <option value={PastMedicalEntryType.DIAGNOSIS}>Relevant Past Diagnosis</option>
                <option value={PastMedicalEntryType.PROCEDURE}>Medical Procedure</option>
                <option value={PastMedicalEntryType.HOSPITALIZATION}>Hospitalization</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pastTitle">Description / Title *</Label>
              <Input
                id="pastTitle"
                value={pastTitle}
                onChange={(e) => setPastTitle(e.target.value)}
                placeholder="e.g., Dengue Fever, Endoscopy, Overnight IV Observation"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pastDateOrYear">Year / Approx. Time</Label>
                <Input
                  id="pastDateOrYear"
                  value={pastDateOrYear}
                  onChange={(e) => setPastDateOrYear(e.target.value)}
                  placeholder="e.g., 2021 or Mar 2022"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pastRecordedDate">Exact Date (Optional)</Label>
                <Input
                  id="pastRecordedDate"
                  type="date"
                  value={pastRecordedDate}
                  onChange={(e) => setPastRecordedDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pastFacility">Hospital / Clinic (Optional)</Label>
              <Input
                id="pastFacility"
                value={pastFacility}
                onChange={(e) => setPastFacility(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pastNotes">Notes (Optional)</Label>
              <Textarea
                id="pastNotes"
                value={pastNotes}
                onChange={(e) => setPastNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPastOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !pastTitle.trim()}
              onClick={() =>
                runAction(
                  () =>
                    savePatientPastMedicalEntryAction({
                      id: pastEditingId,
                      entryType: pastType,
                      title: pastTitle,
                      dateOrYear: pastDateOrYear || null,
                      recordedDate: pastRecordedDate || null,
                      facility: pastFacility || null,
                      notes: pastNotes || null,
                    }),
                  () => setPastOpen(false)
                )
              }
            >
              {isPending ? "Saving..." : "Save Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: SURGICAL HISTORY ADD / EDIT */}
      <Dialog open={surgeryOpen} onOpenChange={setSurgeryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{surgeryEditingId ? "Edit Surgical Record" : "Add Surgical History"}</DialogTitle>
            <DialogDescription>
              Document prior surgeries or operative procedures.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="surgeryName">Surgery / Procedure Name *</Label>
              <Input
                id="surgeryName"
                value={surgeryName}
                onChange={(e) => setSurgeryName(e.target.value)}
                placeholder="e.g., Appendectomy, Knee Arthroscopy"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="surgeryDateOrYear">Date or Year</Label>
                <Input
                  id="surgeryDateOrYear"
                  value={surgeryDateOrYear}
                  onChange={(e) => setSurgeryDateOrYear(e.target.value)}
                  placeholder="e.g., 2019"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="surgeryDate">Exact Date (Optional)</Label>
                <Input
                  id="surgeryDate"
                  type="date"
                  value={surgeryDate}
                  onChange={(e) => setSurgeryDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="surgeryHospital">Hospital / Clinic (Optional)</Label>
              <Input
                id="surgeryHospital"
                value={surgeryHospital}
                onChange={(e) => setSurgeryHospital(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="surgeryNotes">Notes (Optional)</Label>
              <Textarea
                id="surgeryNotes"
                value={surgeryNotes}
                onChange={(e) => setSurgeryNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSurgeryOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !surgeryName.trim()}
              onClick={() =>
                runAction(
                  () =>
                    savePatientSurgeryAction({
                      id: surgeryEditingId,
                      procedureName: surgeryName,
                      dateOrYear: surgeryDateOrYear || null,
                      surgeryDate: surgeryDate || null,
                      hospitalOrClinic: surgeryHospital || null,
                      notes: surgeryNotes || null,
                    }),
                  () => setSurgeryOpen(false)
                )
              }
            >
              {isPending ? "Saving..." : "Save Surgery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: FAMILY MEDICAL HISTORY ADD / EDIT */}
      <Dialog open={familyOpen} onOpenChange={setFamilyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{familyEditingId ? "Edit Family History" : "Add Family Medical History"}</DialogTitle>
            <DialogDescription>
              Record medical conditions that occur in blood relatives.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="familyCondition">Condition *</Label>
              <Input
                id="familyCondition"
                value={familyCondition}
                onChange={(e) => setFamilyCondition(e.target.value)}
                placeholder="e.g., Hypertension, Coronary Artery Disease"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="familyRelationship">Relationship *</Label>
              <select
                id="familyRelationship"
                value={familyRelationship}
                onChange={(e) => setFamilyRelationship(e.target.value)}
                className={SELECT_CLASS}
              >
                {FAMILY_RELATIONSHIP_OPTIONS.map((rel) => (
                  <option key={rel} value={rel}>
                    {rel}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="familyNotes">Additional Notes (Optional)</Label>
              <Textarea
                id="familyNotes"
                value={familyNotes}
                onChange={(e) => setFamilyNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFamilyOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !familyCondition.trim() || !familyRelationship.trim()}
              onClick={() =>
                runAction(
                  () =>
                    savePatientFamilyHistoryAction({
                      id: familyEditingId,
                      condition: familyCondition,
                      relationship: familyRelationship,
                      notes: familyNotes || null,
                    }),
                  () => setFamilyOpen(false)
                )
              }
            >
              {isPending ? "Saving..." : "Save Family History"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONFIRM DELETE DIALOG */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Removal</DialogTitle>
            <DialogDescription>{deleteTarget?.label}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                if (!deleteTarget) return;
                const target = deleteTarget;
                runAction(target.onConfirm, () => setDeleteTarget(null));
              }}
            >
              {isPending ? "Removing..." : "Remove Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Keep Phone icon referenced cleanly if emergency contact exists on overview */}
      {record.profile.emergencyContactPhone && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Phone className="h-3.5 w-3.5 text-primary" />
          Emergency Contact: {record.profile.emergencyContactName ?? "Listed"} (
          {record.profile.emergencyContactPhone})
        </div>
      )}
    </div>
  );
}
