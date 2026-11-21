import { z } from "zod";
import {
  AllergyCategory,
  AllergySeverity,
  ConditionStatus,
  PastMedicalEntryType,
} from "@/generated/prisma/enums";

export const BLOOD_GROUP_OPTIONS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

export const FAMILY_RELATIONSHIP_OPTIONS = [
  "Father",
  "Mother",
  "Sibling",
  "Grandparent",
  "Child",
  "Uncle/Aunt",
  "Other",
] as const;

export const MEDICINE_ROUTE_OPTIONS = [
  "Oral",
  "Sublingual",
  "Topical",
  "Inhaled",
  "Drops",
  "Nasal",
  "Intravenous (IV)",
  "Intramuscular (IM)",
  "Subcutaneous",
  "Other",
] as const;

export const INSTRUCTION_PRESET_OPTIONS = [
  "After food",
  "Before food",
  "With food",
  "Empty stomach",
  "At bedtime",
  "As needed (SOS)",
] as const;

function emptyToNull(val: unknown): unknown {
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return val ?? null;
}

function optionalTextSchema(maxLen: number, label: string) {
  return z.preprocess(
    emptyToNull,
    z
      .string()
      .max(maxLen, `${label} cannot exceed ${maxLen} characters.`)
      .nullable()
  );
}

const DATE_YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_YYYY_MM_DD_REGEX.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

function optionalDateStringSchema(
  label: string,
  options: { allowFuture?: boolean } = {}
) {
  return z.preprocess(
    emptyToNull,
    z
      .string()
      .refine((v) => isValidCalendarDate(v), {
        message: `${label} must be a valid date (YYYY-MM-DD).`,
      })
      .refine(
        (v) => {
          if (options.allowFuture) return true;
          const [y, m, d] = v.split("-").map(Number);
          const candidate = Date.UTC(y, m - 1, d);
          const now = new Date();
          const todayUtc = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1
          );
          return candidate <= todayUtc;
        },
        { message: `${label} cannot be in the future.` }
      )
      .nullable()
  );
}

export const patientMedicalProfileSchema = z.object({
  bloodGroup: z.preprocess(
    emptyToNull,
    z
      .enum(BLOOD_GROUP_OPTIONS, {
        message: "Please select a valid blood group.",
      })
      .nullable()
  ),
  lifestyleNotes: optionalTextSchema(2000, "Lifestyle information"),
  otherMedicalNotes: optionalTextSchema(2000, "Additional medical notes"),
  emergencyContactName: optionalTextSchema(120, "Emergency contact name"),
  emergencyContactPhone: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^[+\d\s\-()]{7,20}$/, "Enter a valid emergency contact phone number.")
      .nullable()
  ),
  emergencyContactRelation: optionalTextSchema(60, "Emergency contact relationship"),
});

export type PatientMedicalProfileInput = z.input<typeof patientMedicalProfileSchema>;

const optionalRecordIdSchema = z.string().trim().min(1).max(128).optional();

export const allergySchema = z.object({
  id: optionalRecordIdSchema,
  category: z.nativeEnum(AllergyCategory),
  allergen: z
    .string()
    .trim()
    .min(1, "Allergen name is required.")
    .max(150, "Allergen name cannot exceed 150 characters."),
  reaction: optionalTextSchema(500, "Reaction"),
  severity: z.nativeEnum(AllergySeverity),
  notes: optionalTextSchema(1000, "Notes"),
});

export type AllergyInput = z.input<typeof allergySchema>;

export const conditionSchema = z.object({
  id: optionalRecordIdSchema,
  name: z
    .string()
    .trim()
    .min(1, "Condition or diagnosis name is required.")
    .max(200, "Condition name cannot exceed 200 characters."),
  diagnosedDate: optionalDateStringSchema("Diagnosed date"),
  status: z.nativeEnum(ConditionStatus),
  notes: optionalTextSchema(1000, "Notes"),
});

export type ConditionInput = z.input<typeof conditionSchema>;

export const medicationSchema = z
  .object({
    id: optionalRecordIdSchema,
    medicineName: z
      .string()
      .trim()
      .min(1, "Medicine name is required.")
      .max(200, "Medicine name cannot exceed 200 characters."),
    dosage: optionalTextSchema(120, "Dosage"),
    frequency: optionalTextSchema(120, "Frequency"),
    startDate: optionalDateStringSchema("Start date"),
    endDate: optionalDateStringSchema("End date", { allowFuture: true }),
    prescribedBy: optionalTextSchema(150, "Prescribed by"),
    notes: optionalTextSchema(1000, "Notes"),
  })
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true;
      return data.endDate >= data.startDate;
    },
    {
      message: "End date cannot be earlier than start date.",
      path: ["endDate"],
    }
  );

export type MedicationInput = z.input<typeof medicationSchema>;

export const pastMedicalEntrySchema = z.object({
  id: optionalRecordIdSchema,
  entryType: z.nativeEnum(PastMedicalEntryType),
  title: z
    .string()
    .trim()
    .min(1, "Title or description is required.")
    .max(200, "Title cannot exceed 200 characters."),
  dateOrYear: optionalTextSchema(50, "Date or year"),
  recordedDate: optionalDateStringSchema("Recorded date"),
  facility: optionalTextSchema(200, "Hospital or facility"),
  notes: optionalTextSchema(1000, "Notes"),
});

export type PastMedicalEntryInput = z.input<typeof pastMedicalEntrySchema>;

export const surgerySchema = z.object({
  id: optionalRecordIdSchema,
  procedureName: z
    .string()
    .trim()
    .min(1, "Surgery or procedure name is required.")
    .max(200, "Surgery name cannot exceed 200 characters."),
  dateOrYear: optionalTextSchema(50, "Date or year"),
  surgeryDate: optionalDateStringSchema("Surgery date"),
  hospitalOrClinic: optionalTextSchema(200, "Hospital or clinic"),
  notes: optionalTextSchema(1000, "Notes"),
});

export type SurgeryInput = z.input<typeof surgerySchema>;

export const familyHistorySchema = z.object({
  id: optionalRecordIdSchema,
  condition: z
    .string()
    .trim()
    .min(1, "Condition name is required.")
    .max(200, "Condition cannot exceed 200 characters."),
  relationship: z
    .string()
    .trim()
    .min(1, "Relationship is required.")
    .max(80, "Relationship cannot exceed 80 characters."),
  notes: optionalTextSchema(1000, "Notes"),
});

export type FamilyHistoryInput = z.input<typeof familyHistorySchema>;

export const prescriptionMedicineSchema = z.object({
  medicineName: z
    .string()
    .trim()
    .min(1, "Medicine name is required.")
    .max(200, "Medicine name cannot exceed 200 characters."),
  dosage: z
    .string()
    .trim()
    .min(1, "Dosage is required.")
    .max(120, "Dosage cannot exceed 120 characters."),
  route: optionalTextSchema(80, "Route of administration"),
  frequency: z
    .string()
    .trim()
    .min(1, "Frequency is required.")
    .max(120, "Frequency cannot exceed 120 characters."),
  duration: z
    .string()
    .trim()
    .min(1, "Duration is required.")
    .max(120, "Duration cannot exceed 120 characters."),
  quantity: optionalTextSchema(80, "Quantity"),
  instructions: optionalTextSchema(300, "Instructions"),
  notes: optionalTextSchema(500, "Medicine notes"),
});

export type PrescriptionMedicineInput = z.input<typeof prescriptionMedicineSchema>;

export const createPrescriptionSchema = z.object({
  patientId: z.string().min(1, "Patient ID is required."),
  appointmentId: z.preprocess(emptyToNull, z.string().min(1).nullable()),
  idempotencyKey: optionalTextSchema(120, "Idempotency key"),
  diagnosis: z
    .string()
    .trim()
    .min(2, "Diagnosis is required.")
    .max(1500, "Diagnosis cannot exceed 1500 characters."),
  generalInstructions: optionalTextSchema(2000, "General instructions"),
  lifestyleAdvice: optionalTextSchema(2000, "Lifestyle / diet advice"),
  followUpRecommendation: optionalTextSchema(1000, "Follow-up recommendation"),
  followUpDate: optionalDateStringSchema("Follow-up date", { allowFuture: true }),
  notes: optionalTextSchema(2000, "Additional notes"),
  medicines: z
    .array(prescriptionMedicineSchema)
    .min(1, "At least one medicine must be added to a prescription.")
    .max(25, "A single prescription cannot exceed 25 medicines."),
});

export type CreatePrescriptionInput = z.input<typeof createPrescriptionSchema>;

export function parseNullableDateUTC(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  if (!isValidCalendarDate(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}
