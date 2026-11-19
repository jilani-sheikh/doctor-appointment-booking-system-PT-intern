"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AllergySeverity } from "@/generated/prisma/enums";
import {
  createPrescriptionAction,
  getPatientMedicalRecordForDoctorAction,
} from "@/lib/actions/prescriptions";
import {
  formatAllergySeverityLabel,
  type SerializedAllergy,
} from "@/lib/medical-records";
import {
  createPrescriptionSchema,
  INSTRUCTION_PRESET_OPTIONS,
  MEDICINE_ROUTE_OPTIONS,
} from "@/lib/validations/medical-records";
import { formatDateIST } from "@/lib/time";
import type { DoctorPrescribeLaunchContext } from "./patient-history-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  Pill,
  Plus,
  Trash2,
  User,
} from "lucide-react";

interface MedicineDraft {
  medicineName: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
  notes: string;
}

const EMPTY_MEDICINE = (): MedicineDraft => ({
  medicineName: "",
  dosage: "",
  route: "Oral",
  frequency: "",
  duration: "",
  quantity: "",
  instructions: "",
  notes: "",
});

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface CreatePrescriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DoctorPrescribeLaunchContext | null;
  onCreated?: (prescriptionId: string) => void;
}

export function CreatePrescriptionDialog({
  open,
  onOpenChange,
  target,
  onCreated,
}: CreatePrescriptionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        {open && target && (
          <CreatePrescriptionFormBody
            key={`${target.patientId}:${target.appointmentId ?? "none"}`}
            target={target}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function CreatePrescriptionFormBody({
  target,
  onClose,
  onCreated,
}: {
  target: DoctorPrescribeLaunchContext;
  onClose: () => void;
  onCreated?: (prescriptionId: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [idempotencyKey] = useState<string>(generateIdempotencyKey);
  const [allergies, setAllergies] = useState<SerializedAllergy[]>(
    () => target.allergies ?? []
  );
  const [allergiesState, setAllergiesState] = useState<"loading" | "loaded" | "error">(
    () => (target.allergies ? "loaded" : "loading")
  );

  const [diagnosis, setDiagnosis] = useState("");
  const [medicines, setMedicines] = useState<MedicineDraft[]>([EMPTY_MEDICINE()]);
  const [generalInstructions, setGeneralInstructions] = useState("");
  const [lifestyleAdvice, setLifestyleAdvice] = useState("");
  const [followUpRecommendation, setFollowUpRecommendation] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (target.allergies) return;

    let cancelled = false;
    getPatientMedicalRecordForDoctorAction({
      patientId: target.patientId,
      appointmentId: target.appointmentId ?? null,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setAllergies(res.data.allergies);
          setAllergiesState("loaded");
        } else {
          setAllergiesState("error");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllergiesState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [target.allergies, target.patientId, target.appointmentId]);

  const updateMedicine = (idx: number, patch: Partial<MedicineDraft>) => {
    setMedicines((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, ...patch } : m))
    );
  };

  const addMedicineRow = () => {
    setMedicines((prev) => [...prev, EMPTY_MEDICINE()]);
  };

  const removeMedicineRow = (idx: number) => {
    setMedicines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const buildPayload = () => ({
    patientId: target.patientId,
    appointmentId: target.appointmentId ?? null,
    idempotencyKey,
    diagnosis,
    generalInstructions: generalInstructions || null,
    lifestyleAdvice: lifestyleAdvice || null,
    followUpRecommendation: followUpRecommendation || null,
    followUpDate: followUpDate || null,
    notes: notes || null,
    medicines: medicines.map((m) => ({
      medicineName: m.medicineName,
      dosage: m.dosage,
      route: m.route || null,
      frequency: m.frequency,
      duration: m.duration,
      quantity: m.quantity || null,
      instructions: m.instructions || null,
      notes: m.notes || null,
    })),
  });

  const handleProceedToReview = () => {
    const parsed = createPrescriptionSchema.safeParse(buildPayload());
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? "Please complete required fields."
      );
      return;
    }
    setValidationError(null);
    setStep("review");
  };

  const handleSubmitPrescription = () => {
    startTransition(async () => {
      const res = await createPrescriptionAction(buildPayload());
      if (res.success) {
        toast.success(res.message ?? "Prescription saved and patient notified.");
        onClose();
        onCreated?.(res.prescriptionId);
        router.refresh();
      } else {
        setValidationError(res.error);
        toast.error(res.error);
      }
    });
  };

  const hasSevereAllergy = allergies.some((a) => a.severity === AllergySeverity.SEVERE);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-lg">
          <Pill className="h-5 w-5 text-primary" />
          {step === "edit" ? "Write Prescription" : "Review & Confirm Prescription"}
        </DialogTitle>
        <DialogDescription>
          Linked directly to permanent patient identity and consultation context.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
            {/* Target Patient Identity Banner */}
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <User className="h-4 w-4 text-primary" />
                <span className="font-bold text-sm text-foreground">{target.patientName}</span>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {target.patientCode}
                </Badge>
                {target.ageLabel && <span className="text-muted-foreground">{target.ageLabel}</span>}
                {target.gender && <span className="text-muted-foreground">• {target.gender}</span>}
              </div>
              {(target.tokenLabel || target.subSlotLabel) && (
                <Badge className="bg-primary text-primary-foreground text-[11px]">
                  {target.tokenLabel ? `Token ${target.tokenLabel}` : ""}
                  {target.tokenLabel && target.subSlotLabel ? " • " : ""}
                  {target.subSlotLabel ?? ""}
                </Badge>
              )}
            </div>

            {/* Clinical Allergy Reminder */}
            {allergiesState === "loading" && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Checking documented patient allergies...
              </div>
            )}
            {allergiesState === "error" && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                Could not load allergy summary automatically. Verify patient allergies via View History before confirming.
              </div>
            )}
            {allergies.length > 0 && (
              <div
                role="alert"
                className={`rounded-xl border p-3 text-xs space-y-1 ${
                  hasSevereAllergy
                    ? "border-rose-500/50 bg-rose-50 dark:bg-rose-950/35 text-rose-950 dark:text-rose-100"
                    : "border-amber-500/40 bg-amber-50 dark:bg-amber-950/25 text-amber-950 dark:text-amber-100"
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                  Patient Allergies ({allergies.length}):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allergies.map((a) => (
                    <Badge
                      key={a.id}
                      className={
                        a.severity === AllergySeverity.SEVERE
                          ? "bg-rose-600 text-white text-[10px]"
                          : "bg-amber-600 text-white text-[10px]"
                      }
                    >
                      {a.allergen} ({formatAllergySeverityLabel(a.severity)}
                      {a.reaction ? `: ${a.reaction}` : ""})
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {validationError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-medium">
                {validationError}
              </div>
            )}

            {step === "edit" ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rxDiagnosis">Diagnosis *</Label>
                  <Textarea
                    id="rxDiagnosis"
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="Enter primary diagnosis or clinical assessment..."
                    rows={2}
                  />
                </div>

                {/* Medicines Dynamic Builder */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-bold">
                      Medicines ({medicines.length}) *
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="gap-1"
                      onClick={addMedicineRow}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Medicine
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {medicines.map((med, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-primary">
                            Medicine #{idx + 1}
                          </span>
                          {medicines.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="text-destructive hover:text-destructive gap-1"
                              onClick={() => removeMedicineRow(idx)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div className="space-y-1">
                            <Label className="text-xs">Medicine Name *</Label>
                            <Input
                              value={med.medicineName}
                              onChange={(e) =>
                                updateMedicine(idx, { medicineName: e.target.value })
                              }
                              placeholder="e.g., Amoxicillin"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Dosage *</Label>
                            <Input
                              value={med.dosage}
                              onChange={(e) => updateMedicine(idx, { dosage: e.target.value })}
                              placeholder="e.g., 500 mg"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Route (Optional)</Label>
                            <select
                              value={med.route}
                              onChange={(e) => updateMedicine(idx, { route: e.target.value })}
                              className={SELECT_CLASS}
                            >
                              <option value="">Not specified</option>
                              {MEDICINE_ROUTE_OPTIONS.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div className="space-y-1">
                            <Label className="text-xs">Frequency *</Label>
                            <Input
                              value={med.frequency}
                              onChange={(e) =>
                                updateMedicine(idx, { frequency: e.target.value })
                              }
                              placeholder="e.g., 1-0-1 (Twice daily)"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Duration *</Label>
                            <Input
                              value={med.duration}
                              onChange={(e) => updateMedicine(idx, { duration: e.target.value })}
                              placeholder="e.g., 5 days"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Quantity (Optional)</Label>
                            <Input
                              value={med.quantity}
                              onChange={(e) => updateMedicine(idx, { quantity: e.target.value })}
                              placeholder="e.g., 10 tablets"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div className="space-y-1">
                            <Label className="text-xs">Instructions (Optional)</Label>
                            <Input
                              value={med.instructions}
                              onChange={(e) =>
                                updateMedicine(idx, { instructions: e.target.value })
                              }
                              placeholder="e.g., After food"
                              list={`rx-instr-${idx}`}
                            />
                            <datalist id={`rx-instr-${idx}`}>
                              {INSTRUCTION_PRESET_OPTIONS.map((opt) => (
                                <option key={opt} value={opt} />
                              ))}
                            </datalist>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Medicine Notes (Optional)</Label>
                            <Input
                              value={med.notes}
                              onChange={(e) => updateMedicine(idx, { notes: e.target.value })}
                              placeholder="Additional note for this medicine"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Prescription-Level Advice */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="rxGeneralInstructions">General Instructions (Optional)</Label>
                    <Textarea
                      id="rxGeneralInstructions"
                      value={generalInstructions}
                      onChange={(e) => setGeneralInstructions(e.target.value)}
                      placeholder="Complete full course, hydration, warning signs..."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rxLifestyleAdvice">Lifestyle / Diet Advice (Optional)</Label>
                    <Textarea
                      id="rxLifestyleAdvice"
                      value={lifestyleAdvice}
                      onChange={(e) => setLifestyleAdvice(e.target.value)}
                      placeholder="Light diet, rest, avoid spicy/cold foods..."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rxFollowUp">Follow-Up Recommendation (Optional)</Label>
                    <Input
                      id="rxFollowUp"
                      value={followUpRecommendation}
                      onChange={(e) => setFollowUpRecommendation(e.target.value)}
                      placeholder="e.g., Review if fever persists after 3 days"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rxFollowUpDate">Follow-Up Date (Optional)</Label>
                    <Input
                      id="rxFollowUpDate"
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rxNotes">Additional Notes (Optional)</Label>
                  <Textarea
                    id="rxNotes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            ) : (
              /* REVIEW STEP BEFORE SAVE */
              <div className="space-y-4 text-sm">
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                    Diagnosis
                  </p>
                  <p className="font-medium text-foreground mt-0.5 whitespace-pre-wrap">
                    {diagnosis}
                  </p>
                </div>

                <div className="border border-border rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b border-border text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Medicine</th>
                        <th className="py-2 px-3">Dosage</th>
                        <th className="py-2 px-3">Frequency</th>
                        <th className="py-2 px-3">Duration</th>
                        <th className="py-2 px-3">Instructions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {medicines.map((med, i) => (
                        <tr key={i}>
                          <td className="py-2.5 px-3 text-muted-foreground">{i + 1}</td>
                          <td className="py-2.5 px-3 font-semibold text-foreground">
                            {med.medicineName}
                            {med.route ? ` (${med.route})` : ""}
                            {med.quantity ? ` • ${med.quantity}` : ""}
                          </td>
                          <td className="py-2.5 px-3">{med.dosage}</td>
                          <td className="py-2.5 px-3">{med.frequency}</td>
                          <td className="py-2.5 px-3">{med.duration}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">
                            {[med.instructions, med.notes].filter(Boolean).join(" • ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {(generalInstructions ||
                  lifestyleAdvice ||
                  followUpRecommendation ||
                  followUpDate ||
                  notes) && (
                  <div className="rounded-xl border border-border bg-muted/20 p-3.5 text-xs space-y-1">
                    {generalInstructions && (
                      <p>
                        <strong>General Instructions:</strong> {generalInstructions}
                      </p>
                    )}
                    {lifestyleAdvice && (
                      <p>
                        <strong>Lifestyle / Diet Advice:</strong> {lifestyleAdvice}
                      </p>
                    )}
                    {(followUpRecommendation || followUpDate) && (
                      <p>
                        <strong>Follow-Up:</strong>{" "}
                        {followUpDate ? `${formatDateIST(followUpDate)} ` : ""}
                        {followUpRecommendation}
                      </p>
                    )}
                    {notes && (
                      <p>
                        <strong>Notes:</strong> {notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

        <DialogFooter className="pt-2">
          {step === "edit" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" className="gap-1.5" onClick={handleProceedToReview}>
                <Eye className="h-4 w-4" />
                Review Prescription
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                className="gap-1.5"
                onClick={() => setStep("edit")}
              >
                <ArrowLeft className="h-4 w-4" />
                Edit Details
              </Button>
              <Button
                type="button"
                disabled={isPending}
                className="gap-1.5"
                onClick={handleSubmitPrescription}
              >
                <CheckCircle2 className="h-4 w-4" />
                {isPending ? "Saving..." : "Confirm & Issue Prescription"}
              </Button>
            </>
          )}
        </DialogFooter>
    </>
  );
}
