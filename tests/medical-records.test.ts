import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AllergyCategory,
  AllergySeverity,
  AppointmentStatus,
  AvailabilityKind,
  ConditionStatus,
  DoctorStatus,
  PastMedicalEntryType,
  Role,
} from "../src/generated/prisma/enums";
import {
  buildClinicalTimeline,
  buildPatientIdentityHeader,
  canDoctorIssuePrescription,
  canDoctorViewPatientRecord,
  formatPatientCode,
  hasAnyPatientMedicalHistory,
  sortAllergiesBySeverity,
} from "../src/lib/medical-records";
import { buildDoctorLiveQueueData } from "../src/lib/doctor-queue";
import {
  allergySchema,
  conditionSchema,
  createPrescriptionSchema,
  familyHistorySchema,
  medicationSchema,
  pastMedicalEntrySchema,
  patientMedicalProfileSchema,
  surgerySchema,
} from "../src/lib/validations/medical-records";
import { createISTDate } from "../src/lib/time";

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("Patient medical profile & structured sub-section schemas validate partial and structured records", () => {
  // Partial medical overview (all fields optional)
  const partialProfile = patientMedicalProfileSchema.safeParse({
    bloodGroup: "O+",
    lifestyleNotes: "",
    otherMedicalNotes: null,
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
  });
  assert.equal(partialProfile.success, true);
  if (partialProfile.success) {
    assert.equal(partialProfile.data.bloodGroup, "O+");
    assert.equal(partialProfile.data.lifestyleNotes, null);
  }

  // Reject invalid blood group
  assert.equal(
    patientMedicalProfileSchema.safeParse({ bloodGroup: "Z+" }).success,
    false
  );

  // Allergies & severity ordering (SEVERE -> MODERATE -> MILD)
  assert.equal(
    allergySchema.safeParse({
      category: AllergyCategory.MEDICINE,
      allergen: "Penicillin",
      reaction: "Anaphylaxis",
      severity: AllergySeverity.SEVERE,
      notes: "Carry EpiPen",
    }).success,
    true
  );
  assert.equal(
    allergySchema.safeParse({
      category: AllergyCategory.FOOD,
      allergen: "   ",
      severity: AllergySeverity.MILD,
    }).success,
    false
  );

  const sorted = sortAllergiesBySeverity([
    { id: "a_mild", severity: AllergySeverity.MILD, createdAt: "2026-11-18T10:00:00Z" },
    { id: "a_sev", severity: AllergySeverity.SEVERE, createdAt: "2026-11-17T10:00:00Z" },
    { id: "a_mod", severity: AllergySeverity.MODERATE, createdAt: "2026-11-19T10:00:00Z" },
  ]);
  assert.deepEqual(
    sorted.map((s) => s.id),
    ["a_sev", "a_mod", "a_mild"]
  );

  // Conditions, Medications (endDate >= startDate check), Past History, Surgeries, Family History
  assert.equal(
    conditionSchema.safeParse({
      name: "Hypertension",
      diagnosedDate: "2023-04-12",
      status: ConditionStatus.ONGOING,
    }).success,
    true
  );
  assert.equal(
    medicationSchema.safeParse({
      medicineName: "Amoxicillin",
      dosage: "500mg",
      frequency: "Twice daily",
      startDate: "2026-11-10",
      endDate: "2026-11-05",
    }).success,
    false
  );
  assert.equal(
    medicationSchema.safeParse({
      medicineName: "Metformin",
      dosage: "500mg",
      frequency: "Once daily",
      startDate: "2026-01-10",
      endDate: "",
      prescribedBy: "Dr. Rao",
    }).success,
    true
  );
  assert.equal(
    pastMedicalEntrySchema.safeParse({
      entryType: PastMedicalEntryType.HOSPITALIZATION,
      title: "Dengue admission",
      dateOrYear: "2021",
      facility: "City Hospital",
    }).success,
    true
  );
  assert.equal(
    surgerySchema.safeParse({
      procedureName: "Appendectomy",
      dateOrYear: "2018",
      hospitalOrClinic: "Apollo Clinic",
    }).success,
    true
  );
  assert.equal(
    familyHistorySchema.safeParse({
      condition: "Type 2 Diabetes",
      relationship: "Father",
    }).success,
    true
  );
});

test("Empty medical profile check returns false only when all patient medical sections are empty", () => {
  assert.equal(
    hasAnyPatientMedicalHistory({
      profile: {
        bloodGroup: null,
        lifestyleNotes: null,
        otherMedicalNotes: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        emergencyContactRelation: null,
      },
      allergies: [],
      conditions: [],
      medications: [],
      pastMedicalEntries: [],
      surgeries: [],
      familyHistories: [],
    }),
    false
  );

  assert.equal(
    hasAnyPatientMedicalHistory({
      profile: { bloodGroup: "B+" },
      allergies: [],
      conditions: [],
      medications: [],
      pastMedicalEntries: [],
      surgeries: [],
      familyHistories: [],
    }),
    true
  );
});

test("Same-name patients in queue preserve distinct permanent patientId, patientCode, and age identity per row", () => {
  const now = createISTDate(2026, 11, 20, 10, 0);
  const slotStart = createISTDate(2026, 11, 20, 10, 0);
  const slotEnd = createISTDate(2026, 11, 20, 11, 0);

  const queueData = buildDoctorLiveQueueData(
    [
      {
        id: "appt_rahul_t1",
        availabilityId: "av_1",
        status: AppointmentStatus.CHECKED_IN,
        tokenNumber: 1,
        queueScopeKey: "doc1:2026-11-20:av_1",
        checkedInAt: createISTDate(2026, 11, 20, 9, 45),
        calledAt: null,
        completedAt: null,
        actualStartAt: null,
        actualEndAt: null,
        createdAt: slotStart,
        slotStart: null,
        slotEnd: null,
        patient: {
          id: "pat_clx9001alpha",
          dateOfBirth: new Date("1998-03-10T00:00:00Z"),
          gender: "Male",
          user: { name: "Rahul Sharma" },
        },
        availability: {
          id: "av_1",
          doctorId: "doc1",
          kind: AvailabilityKind.WAVE_SLOT,
          startTime: slotStart,
          endTime: slotEnd,
        },
      },
      {
        id: "appt_rahul_t2",
        availabilityId: "av_1",
        status: AppointmentStatus.CHECKED_IN,
        tokenNumber: 2,
        queueScopeKey: "doc1:2026-11-20:av_1",
        checkedInAt: createISTDate(2026, 11, 20, 9, 50),
        calledAt: null,
        completedAt: null,
        actualStartAt: null,
        actualEndAt: null,
        createdAt: slotStart,
        slotStart: null,
        slotEnd: null,
        patient: {
          id: "pat_clx9002betaz",
          dateOfBirth: new Date("1972-07-22T00:00:00Z"),
          gender: "Male",
          user: { name: "Rahul Sharma" },
        },
        availability: {
          id: "av_1",
          doctorId: "doc1",
          kind: AvailabilityKind.WAVE_SLOT,
          startTime: slotStart,
          endTime: slotEnd,
        },
      },
      {
        id: "appt_rahul_t5",
        availabilityId: "av_1",
        status: AppointmentStatus.CONFIRMED,
        tokenNumber: 5,
        queueScopeKey: "doc1:2026-11-20:av_1",
        checkedInAt: null,
        calledAt: null,
        completedAt: null,
        actualStartAt: null,
        actualEndAt: null,
        createdAt: slotStart,
        slotStart: null,
        slotEnd: null,
        patient: {
          id: "pat_clx9005gamma",
          dateOfBirth: new Date("2001-12-01T00:00:00Z"),
          gender: "Male",
          user: { name: "Rahul Sharma" },
        },
        availability: {
          id: "av_1",
          doctorId: "doc1",
          kind: AvailabilityKind.WAVE_SLOT,
          startTime: slotStart,
          endTime: slotEnd,
        },
      },
    ],
    now
  );

  const rows = queueData.subSlots[0]!.activePatients;
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.patientName, "Rahul Sharma");
  assert.equal(rows[1]!.patientName, "Rahul Sharma");
  assert.equal(rows[2]!.patientName, "Rahul Sharma");

  assert.equal(rows[0]!.patientId, "pat_clx9001alpha");
  assert.equal(rows[1]!.patientId, "pat_clx9002betaz");
  assert.equal(rows[2]!.patientId, "pat_clx9005gamma");

  assert.notEqual(rows[0]!.patientCode, rows[1]!.patientCode);
  assert.notEqual(rows[1]!.patientCode, rows[2]!.patientCode);
  assert.equal(rows[0]!.patientCode, formatPatientCode("pat_clx9001alpha"));
  assert.equal(rows[0]!.patientAgeLabel, "28 yrs");
  assert.equal(rows[1]!.patientAgeLabel, "54 yrs");
  assert.equal(rows[2]!.patientAgeLabel, "24 yrs");
});

test("Doctor authorization strictly validates role, approval, appointment ownership, and patientId match", () => {
  // Unapproved / pending doctor rejected
  assert.equal(
    canDoctorViewPatientRecord({
      callerRole: Role.DOCTOR,
      callerDoctorId: "doc_1",
      callerDoctorStatus: DoctorStatus.PENDING,
      requestedPatientId: "pat_1",
      appointmentIdProvided: false,
      hasLegitimateRelationship: true,
    }).allowed,
    false
  );

  // Patient / Receptionist / Admin rejected from doctor medical endpoint
  assert.equal(
    canDoctorViewPatientRecord({
      callerRole: Role.RECEPTIONIST,
      callerDoctorId: null,
      callerDoctorStatus: null,
      requestedPatientId: "pat_1",
      appointmentIdProvided: false,
      hasLegitimateRelationship: true,
    }).allowed,
    false
  );

  // Doctor without legitimate relationship rejected
  assert.equal(
    canDoctorViewPatientRecord({
      callerRole: Role.DOCTOR,
      callerDoctorId: "doc_1",
      callerDoctorStatus: DoctorStatus.APPROVED,
      requestedPatientId: "pat_stranger",
      appointmentIdProvided: false,
      hasLegitimateRelationship: false,
    }).allowed,
    false
  );

  // IDOR protection: mismatched patientId on doctor's own appointment rejected
  assert.equal(
    canDoctorViewPatientRecord({
      callerRole: Role.DOCTOR,
      callerDoctorId: "doc_1",
      callerDoctorStatus: DoctorStatus.APPROVED,
      requestedPatientId: "pat_2",
      appointmentIdProvided: true,
      appointmentMatch: {
        id: "appt_1",
        doctorId: "doc_1",
        patientId: "pat_1",
        status: AppointmentStatus.CHECKED_IN,
      },
      hasLegitimateRelationship: true,
    }).allowed,
    false
  );

  // Doctor cannot access another doctor's appointment
  assert.equal(
    canDoctorIssuePrescription({
      callerRole: Role.DOCTOR,
      callerDoctorId: "doc_1",
      callerDoctorStatus: DoctorStatus.APPROVED,
      requestedPatientId: "pat_1",
      appointmentIdProvided: true,
      appointmentMatch: {
        id: "appt_other",
        doctorId: "doc_2",
        patientId: "pat_1",
        status: AppointmentStatus.IN_CONSULTATION,
      },
      hasEligibleRelationship: true,
    }).allowed,
    false
  );

  // Doctor cannot issue prescription for CANCELLED or NO_SHOW or PENDING_PAYMENT appointments
  for (const blockedStatus of [
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.PENDING_PAYMENT,
  ]) {
    assert.equal(
      canDoctorIssuePrescription({
        callerRole: Role.DOCTOR,
        callerDoctorId: "doc_1",
        callerDoctorStatus: DoctorStatus.APPROVED,
        requestedPatientId: "pat_1",
        appointmentIdProvided: true,
        appointmentMatch: {
          id: "appt_1",
          doctorId: "doc_1",
          patientId: "pat_1",
          status: blockedStatus,
        },
        hasEligibleRelationship: true,
      }).allowed,
      false
    );
  }

  // Valid approved doctor issuing prescription on IN_CONSULTATION/CALLED/COMPLETED appointment succeeds
  assert.equal(
    canDoctorIssuePrescription({
      callerRole: Role.DOCTOR,
      callerDoctorId: "doc_1",
      callerDoctorStatus: DoctorStatus.APPROVED,
      requestedPatientId: "pat_1",
      appointmentIdProvided: true,
      appointmentMatch: {
        id: "appt_1",
        doctorId: "doc_1",
        patientId: "pat_1",
        status: AppointmentStatus.IN_CONSULTATION,
      },
      hasEligibleRelationship: true,
    }).allowed,
    true
  );
});

test("Prescription schema validates multiple medicines and required clinical fields", () => {
  // Missing medicines fails
  assert.equal(
    createPrescriptionSchema.safeParse({
      patientId: "pat_1",
      appointmentId: "appt_1",
      diagnosis: "Acute viral pharyngitis",
      medicines: [],
    }).success,
    false
  );

  // Multiple medicines pass cleanly
  const validRx = createPrescriptionSchema.safeParse({
    patientId: "pat_1",
    appointmentId: "appt_1",
    idempotencyKey: "rx-key-123",
    diagnosis: "Acute bacterial sinusitis",
    generalInstructions: "Stay hydrated and complete full antibiotic course.",
    lifestyleAdvice: "Warm steam inhalation twice daily.",
    followUpRecommendation: "Review after 5 days if symptoms persist.",
    followUpDate: "2026-11-25",
    medicines: [
      {
        medicineName: "Amoxicillin + Clavulanate",
        dosage: "625 mg",
        route: "Oral",
        frequency: "1-0-1",
        duration: "5 days",
        quantity: "10 tablets",
        instructions: "After food",
      },
      {
        medicineName: "Paracetamol",
        dosage: "500 mg",
        route: "Oral",
        frequency: "SOS (max 3/day)",
        duration: "3 days",
        instructions: "After food if fever > 100F",
      },
    ],
  });
  assert.equal(validRx.success, true);
  if (validRx.success) {
    assert.equal(validRx.data.medicines.length, 2);
  }
});

test("Clinical timeline separates Patient-Reported, Clinic Consultation, and Issued Prescription sources chronologically", () => {
  const timeline = buildClinicalTimeline({
    allergies: [
      {
        id: "al_1",
        category: AllergyCategory.MEDICINE,
        allergen: "Sulfa drugs",
        reaction: "Skin rash",
        severity: AllergySeverity.SEVERE,
        notes: null,
        createdAt: "2026-11-10T08:00:00.000Z",
        updatedAt: "2026-11-10T08:00:00.000Z",
      },
    ],
    conditions: [],
    medications: [],
    pastMedicalEntries: [],
    surgeries: [],
    familyHistories: [],
    consultations: [
      {
        id: "appt_1",
        status: AppointmentStatus.COMPLETED,
        statusLabel: "Completed",
        doctorId: "doc_1",
        doctorName: "Meera Nair",
        doctorSpecialization: "General Physician",
        tokenNumber: 3,
        slotStart: "2026-11-18T05:00:00.000Z",
        slotEnd: "2026-11-18T05:30:00.000Z",
        subSlotLabel: "Wave Sub-slot",
        reason: "Sore throat and fever",
        actualStartAt: "2026-11-18T05:05:00.000Z",
        completedAt: "2026-11-18T05:25:00.000Z",
        prescriptionCount: 1,
        diagnoses: ["Acute pharyngitis"],
      },
    ],
    prescriptions: [
      {
        id: "rx_1",
        patientId: "pat_1",
        doctorId: "doc_1",
        appointmentId: "appt_1",
        diagnosis: "Acute pharyngitis",
        doctorName: "Meera Nair",
        doctorSpecialization: "General Physician",
        prescribedAt: "2026-11-18T05:20:00.000Z",
        generalInstructions: "Warm salt water gargle",
        lifestyleAdvice: null,
        followUpRecommendation: null,
        followUpDate: null,
        notes: null,
        appointmentSummary: null,
        medicines: [
          {
            id: "med_1",
            sortOrder: 0,
            medicineName: "Paracetamol",
            dosage: "500mg",
            route: "Oral",
            frequency: "Twice daily",
            duration: "3 days",
            quantity: null,
            instructions: "After food",
            notes: null,
          },
        ],
      },
    ],
  });

  assert.equal(timeline.length, 3);
  assert.equal(timeline[0]!.source, "ISSUED_PRESCRIPTION");
  assert.equal(timeline[0]!.sourceLabel, "Issued Prescription");
  assert.equal(timeline[1]!.source, "CLINIC_CONSULTATION");
  assert.equal(timeline[1]!.sourceLabel, "Clinic Consultation");
  assert.equal(timeline[2]!.source, "PATIENT_REPORTED");
  assert.equal(timeline[2]!.sourceLabel, "Patient-Reported");
});

test("Static security, read-only queue preservation, migration safety, and patient identity invariants", () => {
  const schema = readRepoFile("prisma/schema.prisma");
  assert.match(schema, /enum NotificationType[\s\S]*PRESCRIPTION_ISSUED/);
  assert.match(schema, /model PatientMedicalProfile/);
  assert.match(schema, /model PatientAllergy/);
  assert.match(schema, /model PatientCondition/);
  assert.match(schema, /model PatientMedication/);
  assert.match(schema, /model PatientPastMedicalEntry/);
  assert.match(schema, /model PatientSurgery/);
  assert.match(schema, /model PatientFamilyHistory/);
  assert.match(schema, /model Prescription\b/);
  assert.match(schema, /model PrescriptionMedicine\b/);

  const migrationSql = readRepoFile(
    "prisma/migrations/20261119130000_add_medical_history_and_prescriptions/migration.sql"
  );
  assert.match(migrationSql, /ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRESCRIPTION_ISSUED'/);
  assert.equal(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i.test(migrationSql), false);

  const patientActions = readRepoFile("src/lib/actions/medical-records.ts");
  assert.match(patientActions, /where:\s*\{\s*(id|id:\s*recordId),\s*patientId\s*\}/);
  assert.equal(patientActions.includes("db.prescription.create"), false);
  assert.equal(patientActions.includes("db.prescription.update"), false);
  assert.equal(patientActions.includes("db.prescription.delete"), false);
  assert.equal(/console\.error\([^)]*,\s*error\)/.test(patientActions), false);

  const rxActions = readRepoFile("src/lib/actions/prescriptions.ts");
  assert.equal(/console\.error\([^)]*,\s*error\)/.test(rxActions), false);
  assert.match(rxActions, /patient\.user\.deletedAt/);
  assert.match(rxActions, /scopedIdempotencyKey/);
  assert.equal(rxActions.includes("diagnosisSummary"), false);

  // Non-CUID existing IDs (such as seeded records) remain editable
  assert.equal(
    allergySchema.safeParse({
      id: "allergy_seed_01",
      category: AllergyCategory.FOOD,
      allergen: "Peanuts",
      severity: AllergySeverity.SEVERE,
    }).success,
    true
  );

  const prescriptionDetailPage = readRepoFile(
    "src/app/patient/prescriptions/[prescriptionId]/page.tsx"
  );
  assert.match(prescriptionDetailPage, /prescription\.patientId !== user\.patient\.id/);

  const doctorQueueView = readRepoFile("src/app/doctor/queue/doctor-queue-view.tsx");
  assert.match(doctorQueueView, /View History/);
  assert.match(doctorQueueView, /Write Prescription/);
  assert.match(doctorQueueView, /patientId:\s*row\.patientId/);

  const idHeader = buildPatientIdentityHeader({
    patientId: "c1234567890abcdef",
    name: "Rahul Sharma",
    dateOfBirth: new Date("1995-05-10T00:00:00Z"),
    now: new Date("2026-11-19T00:00:00Z"),
  });
  assert.equal(idHeader.patientCode, "PAT-ABCDEF");
  assert.equal(idHeader.ageLabel, "31 yrs");
});
