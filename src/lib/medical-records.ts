import {
  AllergyCategory,
  AllergySeverity,
  AppointmentStatus,
  AvailabilityKind,
  ConditionStatus,
  DoctorStatus,
  PastMedicalEntryType,
  Role,
} from "@/generated/prisma/enums";
import { formatDoctorDisplayName, formatSubSlotLabel, getQueueStatusLabel } from "@/lib/queue-tokens";
import { effectiveSlot } from "@/lib/scheduling";
import { formatDateIST, formatDateTimeIST, formatSlotDateTimeRangeIST } from "@/lib/time";

export interface SerializedMedicalProfile {
  bloodGroup: string | null;
  lifestyleNotes: string | null;
  otherMedicalNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  updatedAt: string | null;
}

export interface SerializedAllergy {
  id: string;
  category: AllergyCategory;
  allergen: string;
  reaction: string | null;
  severity: AllergySeverity;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedCondition {
  id: string;
  name: string;
  diagnosedDate: string | null;
  status: ConditionStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedMedication {
  id: string;
  medicineName: string;
  dosage: string | null;
  frequency: string | null;
  startDate: string | null;
  endDate: string | null;
  prescribedBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedPastMedicalEntry {
  id: string;
  entryType: PastMedicalEntryType;
  title: string;
  dateOrYear: string | null;
  recordedDate: string | null;
  facility: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedSurgery {
  id: string;
  procedureName: string;
  dateOrYear: string | null;
  surgeryDate: string | null;
  hospitalOrClinic: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedFamilyHistory {
  id: string;
  condition: string;
  relationship: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedPrescriptionMedicine {
  id: string;
  sortOrder: number;
  medicineName: string;
  dosage: string;
  route: string | null;
  frequency: string;
  duration: string;
  quantity: string | null;
  instructions: string | null;
  notes: string | null;
}

export interface SerializedPrescription {
  id: string;
  patientId: string;
  doctorId: string | null;
  appointmentId: string | null;
  diagnosis: string;
  doctorName: string;
  doctorSpecialization: string | null;
  prescribedAt: string;
  generalInstructions: string | null;
  lifestyleAdvice: string | null;
  followUpRecommendation: string | null;
  followUpDate: string | null;
  notes: string | null;
  appointmentSummary: {
    id: string;
    tokenNumber: number | null;
    slotStart: string;
    slotEnd: string;
    subSlotLabel: string;
  } | null;
  medicines: SerializedPrescriptionMedicine[];
}

export interface SerializedConsultationSummary {
  id: string;
  status: AppointmentStatus;
  statusLabel: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialization: string;
  tokenNumber: number | null;
  slotStart: string;
  slotEnd: string;
  subSlotLabel: string;
  reason: string | null;
  actualStartAt: string | null;
  completedAt: string | null;
  prescriptionCount: number;
  diagnoses: string[];
}

export type ClinicalTimelineSource =
  | "PATIENT_REPORTED"
  | "CLINIC_CONSULTATION"
  | "ISSUED_PRESCRIPTION";

export interface ClinicalTimelineEvent {
  id: string;
  source: ClinicalTimelineSource;
  sourceLabel: string;
  category: string;
  title: string;
  subtitle: string | null;
  details: string | null;
  occurredAt: string;
  dateLabel: string;
  appointmentId?: string | null;
  prescriptionId?: string | null;
}

export interface PatientIdentityHeader {
  patientId: string;
  patientCode: string;
  name: string;
  dateOfBirth: string | null;
  ageYears: number | null;
  ageLabel: string | null;
  gender: string | null;
  appointmentId?: string | null;
  tokenNumber?: number | null;
  subSlotLabel?: string | null;
  appointmentStatus?: AppointmentStatus | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export interface CompletePatientMedicalRecord {
  identity: PatientIdentityHeader;
  hasAnyMedicalHistory: boolean;
  profile: SerializedMedicalProfile;
  allergies: SerializedAllergy[];
  conditions: SerializedCondition[];
  medications: SerializedMedication[];
  pastMedicalEntries: SerializedPastMedicalEntry[];
  surgeries: SerializedSurgery[];
  familyHistories: SerializedFamilyHistory[];
  consultations: SerializedConsultationSummary[];
  prescriptions: SerializedPrescription[];
  timeline: ClinicalTimelineEvent[];
}

export const DOCTOR_HISTORY_ELIGIBLE_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.CALLED,
  AppointmentStatus.IN_CONSULTATION,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
];

export const DOCTOR_PRESCRIBE_ELIGIBLE_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.CALLED,
  AppointmentStatus.IN_CONSULTATION,
  AppointmentStatus.COMPLETED,
];

/**
 * Generates a deterministic clinic identifier derived from the permanent database Patient ID
 * so doctors can reliably tell apart queue rows with identical patient names.
 */
export function formatPatientCode(patientId: string): string {
  const cleaned = patientId.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return "PAT-UNKNOWN";
  return `PAT-${cleaned.slice(-6).toUpperCase()}`;
}

export function calculateAgeYears(
  dateOfBirth: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!dateOfBirth) return null;
  const dob = typeof dateOfBirth === "string" ? new Date(dateOfBirth) : dateOfBirth;
  if (Number.isNaN(dob.getTime())) return null;

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
  return age >= 0 && age <= 130 ? age : null;
}

export function buildPatientIdentityHeader(input: {
  patientId: string;
  name: string | null | undefined;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  appointmentId?: string | null;
  tokenNumber?: number | null;
  subSlotLabel?: string | null;
  appointmentStatus?: AppointmentStatus | null;
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  now?: Date;
}): PatientIdentityHeader {
  const ageYears = calculateAgeYears(input.dateOfBirth, input.now);
  const dobIso = input.dateOfBirth
    ? new Date(input.dateOfBirth).toISOString().slice(0, 10)
    : null;
  return {
    patientId: input.patientId,
    patientCode: formatPatientCode(input.patientId),
    name: input.name?.trim() || "Patient",
    dateOfBirth: dobIso,
    ageYears,
    ageLabel: ageYears !== null ? `${ageYears} yrs` : null,
    gender: input.gender ?? null,
    appointmentId: input.appointmentId ?? null,
    tokenNumber: input.tokenNumber ?? null,
    subSlotLabel: input.subSlotLabel ?? null,
    appointmentStatus: input.appointmentStatus ?? null,
    scheduledStart: input.scheduledStart ? new Date(input.scheduledStart).toISOString() : null,
    scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd).toISOString() : null,
  };
}

const ALLERGY_SEVERITY_RANK: Record<AllergySeverity, number> = {
  [AllergySeverity.SEVERE]: 0,
  [AllergySeverity.MODERATE]: 1,
  [AllergySeverity.MILD]: 2,
};

export function sortAllergiesBySeverity<
  T extends { severity: AllergySeverity; createdAt?: Date | string }
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const rankDiff =
      (ALLERGY_SEVERITY_RANK[a.severity] ?? 9) -
      (ALLERGY_SEVERITY_RANK[b.severity] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bMs - aMs;
  });
}

export function hasAnyPatientMedicalHistory(input: {
  profile: {
    bloodGroup?: string | null;
    lifestyleNotes?: string | null;
    otherMedicalNotes?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelation?: string | null;
  } | null;
  allergies: readonly unknown[];
  conditions: readonly unknown[];
  medications: readonly unknown[];
  pastMedicalEntries: readonly unknown[];
  surgeries: readonly unknown[];
  familyHistories: readonly unknown[];
}): boolean {
  const hasProfileContent = Boolean(
    input.profile &&
      (input.profile.bloodGroup ||
        input.profile.lifestyleNotes ||
        input.profile.otherMedicalNotes ||
        input.profile.emergencyContactName ||
        input.profile.emergencyContactPhone ||
        input.profile.emergencyContactRelation)
  );
  return (
    hasProfileContent ||
    input.allergies.length > 0 ||
    input.conditions.length > 0 ||
    input.medications.length > 0 ||
    input.pastMedicalEntries.length > 0 ||
    input.surgeries.length > 0 ||
    input.familyHistories.length > 0
  );
}

export function formatAllergyCategoryLabel(category: AllergyCategory): string {
  switch (category) {
    case AllergyCategory.MEDICINE:
      return "Medicine";
    case AllergyCategory.FOOD:
      return "Food";
    case AllergyCategory.ENVIRONMENTAL:
      return "Environmental";
    default:
      return "Other";
  }
}

export function formatAllergySeverityLabel(severity: AllergySeverity): string {
  switch (severity) {
    case AllergySeverity.SEVERE:
      return "Severe";
    case AllergySeverity.MODERATE:
      return "Moderate";
    case AllergySeverity.MILD:
      return "Mild";
  }
}

export function formatConditionStatusLabel(status: ConditionStatus): string {
  return status === ConditionStatus.ONGOING ? "Ongoing" : "Resolved";
}

export function formatPastEntryTypeLabel(entryType: PastMedicalEntryType): string {
  switch (entryType) {
    case PastMedicalEntryType.ILLNESS:
      return "Previous Illness";
    case PastMedicalEntryType.DIAGNOSIS:
      return "Past Diagnosis";
    case PastMedicalEntryType.PROCEDURE:
      return "Medical Procedure";
    case PastMedicalEntryType.HOSPITALIZATION:
      return "Hospitalization";
  }
}

export function buildClinicalTimeline(input: {
  allergies: readonly SerializedAllergy[];
  conditions: readonly SerializedCondition[];
  medications: readonly SerializedMedication[];
  pastMedicalEntries: readonly SerializedPastMedicalEntry[];
  surgeries: readonly SerializedSurgery[];
  familyHistories: readonly SerializedFamilyHistory[];
  consultations: readonly SerializedConsultationSummary[];
  prescriptions: readonly SerializedPrescription[];
}): ClinicalTimelineEvent[] {
  const events: ClinicalTimelineEvent[] = [];

  for (const a of input.allergies) {
    events.push({
      id: `allergy:${a.id}`,
      source: "PATIENT_REPORTED",
      sourceLabel: "Patient-Reported",
      category: "Allergy",
      title: `${a.allergen} (${formatAllergySeverityLabel(a.severity)} ${formatAllergyCategoryLabel(a.category)} Allergy)`,
      subtitle: a.reaction ? `Reaction: ${a.reaction}` : null,
      details: a.notes,
      occurredAt: a.createdAt,
      dateLabel: `Recorded ${formatDateIST(a.createdAt)}`,
    });
  }

  for (const c of input.conditions) {
    const timestamp = c.diagnosedDate ?? c.createdAt;
    events.push({
      id: `condition:${c.id}`,
      source: "PATIENT_REPORTED",
      sourceLabel: "Patient-Reported",
      category: "Medical Condition",
      title: `${c.name} (${formatConditionStatusLabel(c.status)})`,
      subtitle: c.diagnosedDate
        ? `Diagnosed ${formatDateIST(c.diagnosedDate)}`
        : "Diagnosis date not specified",
      details: c.notes,
      occurredAt: timestamp,
      dateLabel: c.diagnosedDate ? formatDateIST(c.diagnosedDate) : `Added ${formatDateIST(c.createdAt)}`,
    });
  }

  for (const m of input.medications) {
    const timestamp = m.startDate ?? m.createdAt;
    const medMeta = [m.dosage, m.frequency].filter(Boolean).join(" • ");
    events.push({
      id: `medication:${m.id}`,
      source: "PATIENT_REPORTED",
      sourceLabel: "Patient-Reported",
      category: "Current Medication",
      title: m.medicineName,
      subtitle: [medMeta, m.prescribedBy ? `Prescribed by: ${m.prescribedBy}` : null]
        .filter(Boolean)
        .join(" | ") || null,
      details: m.notes,
      occurredAt: timestamp,
      dateLabel: m.startDate
        ? `Started ${formatDateIST(m.startDate)}${m.endDate ? ` – Ended ${formatDateIST(m.endDate)}` : ""}`
        : `Added ${formatDateIST(m.createdAt)}`,
    });
  }

  for (const p of input.pastMedicalEntries) {
    const timestamp = p.recordedDate ?? p.createdAt;
    events.push({
      id: `past:${p.id}`,
      source: "PATIENT_REPORTED",
      sourceLabel: "Patient-Reported",
      category: formatPastEntryTypeLabel(p.entryType),
      title: p.title,
      subtitle: p.facility ? `Facility: ${p.facility}` : null,
      details: p.notes,
      occurredAt: timestamp,
      dateLabel: p.recordedDate
        ? formatDateIST(p.recordedDate)
        : p.dateOrYear
          ? `${p.dateOrYear} (added ${formatDateIST(p.createdAt)})`
          : `Added ${formatDateIST(p.createdAt)}`,
    });
  }

  for (const s of input.surgeries) {
    const timestamp = s.surgeryDate ?? s.createdAt;
    events.push({
      id: `surgery:${s.id}`,
      source: "PATIENT_REPORTED",
      sourceLabel: "Patient-Reported",
      category: "Surgical History",
      title: s.procedureName,
      subtitle: s.hospitalOrClinic ? `Hospital/Clinic: ${s.hospitalOrClinic}` : null,
      details: s.notes,
      occurredAt: timestamp,
      dateLabel: s.surgeryDate
        ? formatDateIST(s.surgeryDate)
        : s.dateOrYear
          ? `${s.dateOrYear} (added ${formatDateIST(s.createdAt)})`
          : `Added ${formatDateIST(s.createdAt)}`,
    });
  }

  for (const f of input.familyHistories) {
    events.push({
      id: `family:${f.id}`,
      source: "PATIENT_REPORTED",
      sourceLabel: "Patient-Reported",
      category: "Family History",
      title: `${f.condition} (${f.relationship})`,
      subtitle: null,
      details: f.notes,
      occurredAt: f.createdAt,
      dateLabel: `Recorded ${formatDateIST(f.createdAt)}`,
    });
  }

  for (const appt of input.consultations) {
    const tokenText = typeof appt.tokenNumber === "number" ? `Token #${appt.tokenNumber}` : null;
    const subtitleParts = [
      appt.doctorSpecialization,
      appt.statusLabel,
      tokenText,
      appt.subSlotLabel,
    ].filter(Boolean);
    const diagText =
      appt.diagnoses.length > 0 ? `Diagnosis: ${appt.diagnoses.join("; ")}` : null;
    const details = [diagText, appt.reason ? `Reason: ${appt.reason}` : null]
      .filter(Boolean)
      .join(" | ");
    events.push({
      id: `consultation:${appt.id}`,
      source: "CLINIC_CONSULTATION",
      sourceLabel: "Clinic Consultation",
      category: "Consultation",
      title: `Consultation with ${formatDoctorDisplayName(appt.doctorName)}`,
      subtitle: subtitleParts.join(" • "),
      details: details || null,
      occurredAt: appt.slotStart,
      dateLabel: `${formatSlotDateTimeRangeIST(appt.slotStart, appt.slotEnd)} IST`,
      appointmentId: appt.id,
    });
  }

  for (const rx of input.prescriptions) {
    const medNames = rx.medicines.map((m) => `${m.medicineName} (${m.dosage})`).join(", ");
    events.push({
      id: `prescription:${rx.id}`,
      source: "ISSUED_PRESCRIPTION",
      sourceLabel: "Issued Prescription",
      category: "Prescription",
      title: `Prescription: ${rx.diagnosis}`,
      subtitle: `${formatDoctorDisplayName(rx.doctorName)}${rx.doctorSpecialization ? ` (${rx.doctorSpecialization})` : ""} • ${rx.medicines.length} medicine(s)`,
      details: medNames || rx.generalInstructions || null,
      occurredAt: rx.prescribedAt,
      dateLabel: `${formatDateTimeIST(rx.prescribedAt)} IST`,
      appointmentId: rx.appointmentId,
      prescriptionId: rx.id,
    });
  }

  return events.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}

export function canDoctorViewPatientRecord(params: {
  callerRole: Role | null | undefined;
  callerDoctorId: string | null | undefined;
  callerDoctorStatus: DoctorStatus | null | undefined;
  requestedPatientId: string;
  appointmentMatch?: {
    id: string;
    doctorId: string;
    patientId: string;
    status: AppointmentStatus;
  } | null;
  appointmentIdProvided: boolean;
  hasLegitimateRelationship: boolean;
}): { allowed: true } | { allowed: false; reason: string } {
  if (params.callerRole !== Role.DOCTOR || !params.callerDoctorId) {
    return { allowed: false, reason: "Only authenticated doctors may view clinical patient history." };
  }
  if (params.callerDoctorStatus !== DoctorStatus.APPROVED) {
    return { allowed: false, reason: "Your practitioner profile must be approved before viewing patient records." };
  }
  if (params.appointmentIdProvided) {
    const appt = params.appointmentMatch;
    if (!appt) {
      return { allowed: false, reason: "Selected consultation appointment was not found." };
    }
    if (appt.doctorId !== params.callerDoctorId) {
      return { allowed: false, reason: "Unauthorized: You cannot view patient history for another doctor's appointment." };
    }
    if (appt.patientId !== params.requestedPatientId) {
      return { allowed: false, reason: "Patient identity mismatch for the selected appointment." };
    }
    if (!DOCTOR_HISTORY_ELIGIBLE_STATUSES.includes(appt.status)) {
      return { allowed: false, reason: `Patient medical history is unavailable for ${appt.status.toLowerCase()} bookings.` };
    }
    return { allowed: true };
  }
  if (!params.hasLegitimateRelationship) {
    return { allowed: false, reason: "Unauthorized: No active or historical consultation relationship exists with this patient." };
  }
  return { allowed: true };
}

export function canDoctorIssuePrescription(params: {
  callerRole: Role | null | undefined;
  callerDoctorId: string | null | undefined;
  callerDoctorStatus: DoctorStatus | null | undefined;
  requestedPatientId: string;
  appointmentMatch?: {
    id: string;
    doctorId: string;
    patientId: string;
    status: AppointmentStatus;
  } | null;
  appointmentIdProvided: boolean;
  hasEligibleRelationship: boolean;
}): { allowed: true } | { allowed: false; reason: string } {
  if (params.callerRole !== Role.DOCTOR || !params.callerDoctorId) {
    return { allowed: false, reason: "Only authenticated doctors may issue prescriptions." };
  }
  if (params.callerDoctorStatus !== DoctorStatus.APPROVED) {
    return { allowed: false, reason: "Your practitioner profile must be approved before issuing prescriptions." };
  }
  if (params.appointmentIdProvided) {
    const appt = params.appointmentMatch;
    if (!appt) {
      return { allowed: false, reason: "Selected consultation appointment was not found." };
    }
    if (appt.doctorId !== params.callerDoctorId) {
      return { allowed: false, reason: "Unauthorized: You cannot issue a prescription for another doctor's consultation." };
    }
    if (appt.patientId !== params.requestedPatientId) {
      return { allowed: false, reason: "Patient identity mismatch for the selected consultation." };
    }
    if (!DOCTOR_PRESCRIBE_ELIGIBLE_STATUSES.includes(appt.status)) {
      return { allowed: false, reason: `Prescriptions cannot be issued for appointments in ${appt.status.toLowerCase()} status.` };
    }
    return { allowed: true };
  }
  if (!params.hasEligibleRelationship) {
    return { allowed: false, reason: "Unauthorized: You can only prescribe for patients who have a confirmed or completed consultation with you." };
  }
  return { allowed: true };
}

export function mapConsultationAppointmentSummary(appt: {
  id: string;
  status: AppointmentStatus;
  tokenNumber: number | null;
  reason: string | null;
  actualStartAt: Date | null;
  completedAt: Date | null;
  slotStart: Date | null;
  slotEnd: Date | null;
  availability: {
    kind: AvailabilityKind;
    startTime: Date;
    endTime: Date;
    doctor: {
      id: string;
      specialization: string;
      user: { name: string | null };
    };
  };
  prescriptions?: Array<{ diagnosis: string }>;
}): SerializedConsultationSummary {
  const slot = effectiveSlot({
    slotStart: appt.slotStart,
    slotEnd: appt.slotEnd,
    availability: appt.availability,
  });
  return {
    id: appt.id,
    status: appt.status,
    statusLabel: getQueueStatusLabel(appt.status),
    doctorId: appt.availability.doctor.id,
    doctorName: appt.availability.doctor.user.name ?? "Doctor",
    doctorSpecialization: appt.availability.doctor.specialization,
    tokenNumber: appt.tokenNumber,
    slotStart: slot.start.toISOString(),
    slotEnd: slot.end.toISOString(),
    subSlotLabel: formatSubSlotLabel({
      kind: appt.availability.kind,
      availabilityStart: appt.availability.startTime,
      availabilityEnd: appt.availability.endTime,
      slotStart: appt.slotStart,
      slotEnd: appt.slotEnd,
    }),
    reason: appt.reason,
    actualStartAt: appt.actualStartAt ? appt.actualStartAt.toISOString() : null,
    completedAt: appt.completedAt ? appt.completedAt.toISOString() : null,
    prescriptionCount: appt.prescriptions?.length ?? 0,
    diagnoses: (appt.prescriptions ?? []).map((p) => p.diagnosis),
  };
}
