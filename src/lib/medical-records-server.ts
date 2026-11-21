import "server-only";

import { db } from "@/lib/db";
import { AppointmentStatus } from "@/generated/prisma/client";
import { formatSubSlotLabel } from "@/lib/queue-tokens";
import { effectiveSlot } from "@/lib/scheduling";
import {
  buildClinicalTimeline,
  buildPatientIdentityHeader,
  hasAnyPatientMedicalHistory,
  mapConsultationAppointmentSummary,
  sortAllergiesBySeverity,
  type CompletePatientMedicalRecord,
  type SerializedAllergy,
  type SerializedCondition,
  type SerializedFamilyHistory,
  type SerializedMedicalProfile,
  type SerializedMedication,
  type SerializedPastMedicalEntry,
  type SerializedPrescription,
  type SerializedSurgery,
} from "@/lib/medical-records";

export async function loadCompletePatientMedicalRecord(input: {
  patientId: string;
  appointmentId?: string | null;
}): Promise<CompletePatientMedicalRecord | null> {
  const { patientId, appointmentId } = input;

  const patient = await db.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      dateOfBirth: true,
      gender: true,
      user: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!patient) return null;

  const [
    profileRow,
    allergyRows,
    conditionRows,
    medicationRows,
    pastEntryRows,
    surgeryRows,
    familyRows,
    consultationRows,
    prescriptionRows,
    focusedAppt,
  ] = await Promise.all([
    db.patientMedicalProfile.findUnique({ where: { patientId } }),
    db.patientAllergy.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    }),
    db.patientCondition.findMany({
      where: { patientId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    db.patientMedication.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    }),
    db.patientPastMedicalEntry.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    }),
    db.patientSurgery.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    }),
    db.patientFamilyHistory.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    }),
    db.appointment.findMany({
      where: {
        patientId,
        status: { not: AppointmentStatus.PENDING_PAYMENT },
      },
      include: {
        availability: {
          include: {
            doctor: {
              select: {
                id: true,
                specialization: true,
                user: { select: { name: true } },
              },
            },
          },
        },
        prescriptions: {
          select: { diagnosis: true },
          orderBy: { prescribedAt: "desc" },
        },
      },
      orderBy: { availability: { startTime: "desc" } },
      take: 50,
    }),
    db.prescription.findMany({
      where: { patientId },
      include: {
        medicines: {
          orderBy: { sortOrder: "asc" },
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
      },
      orderBy: { prescribedAt: "desc" },
    }),
    appointmentId
      ? db.appointment.findFirst({
          where: { id: appointmentId, patientId },
          select: {
            id: true,
            status: true,
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
        })
      : Promise.resolve(null),
  ]);

  const focusedSlot = focusedAppt
    ? effectiveSlot({
        slotStart: focusedAppt.slotStart,
        slotEnd: focusedAppt.slotEnd,
        availability: focusedAppt.availability,
      })
    : null;

  const identity = buildPatientIdentityHeader({
    patientId: patient.id,
    name: patient.user.name,
    dateOfBirth: patient.dateOfBirth,
    gender: patient.gender,
    appointmentId: focusedAppt?.id ?? null,
    tokenNumber: focusedAppt?.tokenNumber ?? null,
    subSlotLabel: focusedAppt
      ? formatSubSlotLabel({
          kind: focusedAppt.availability.kind,
          availabilityStart: focusedAppt.availability.startTime,
          availabilityEnd: focusedAppt.availability.endTime,
          slotStart: focusedAppt.slotStart,
          slotEnd: focusedAppt.slotEnd,
        })
      : null,
    appointmentStatus: focusedAppt?.status ?? null,
    scheduledStart: focusedSlot?.start ?? null,
    scheduledEnd: focusedSlot?.end ?? null,
  });

  const profile: SerializedMedicalProfile = {
    bloodGroup: profileRow?.bloodGroup ?? null,
    lifestyleNotes: profileRow?.lifestyleNotes ?? null,
    otherMedicalNotes: profileRow?.otherMedicalNotes ?? null,
    emergencyContactName: profileRow?.emergencyContactName ?? null,
    emergencyContactPhone: profileRow?.emergencyContactPhone ?? null,
    emergencyContactRelation: profileRow?.emergencyContactRelation ?? null,
    updatedAt: profileRow?.updatedAt ? profileRow.updatedAt.toISOString() : null,
  };

  const allergies: SerializedAllergy[] = sortAllergiesBySeverity(
    allergyRows.map((a) => ({
      id: a.id,
      category: a.category,
      allergen: a.allergen,
      reaction: a.reaction,
      severity: a.severity,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }))
  );

  const conditions: SerializedCondition[] = conditionRows.map((c) => ({
    id: c.id,
    name: c.name,
    diagnosedDate: c.diagnosedDate ? c.diagnosedDate.toISOString() : null,
    status: c.status,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  const medications: SerializedMedication[] = medicationRows.map((m) => ({
    id: m.id,
    medicineName: m.medicineName,
    dosage: m.dosage,
    frequency: m.frequency,
    startDate: m.startDate ? m.startDate.toISOString() : null,
    endDate: m.endDate ? m.endDate.toISOString() : null,
    prescribedBy: m.prescribedBy,
    notes: m.notes,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }));

  const pastMedicalEntries: SerializedPastMedicalEntry[] = pastEntryRows.map((p) => ({
    id: p.id,
    entryType: p.entryType,
    title: p.title,
    dateOrYear: p.dateOrYear,
    recordedDate: p.recordedDate ? p.recordedDate.toISOString() : null,
    facility: p.facility,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  const surgeries: SerializedSurgery[] = surgeryRows.map((s) => ({
    id: s.id,
    procedureName: s.procedureName,
    dateOrYear: s.dateOrYear,
    surgeryDate: s.surgeryDate ? s.surgeryDate.toISOString() : null,
    hospitalOrClinic: s.hospitalOrClinic,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));

  const familyHistories: SerializedFamilyHistory[] = familyRows.map((f) => ({
    id: f.id,
    condition: f.condition,
    relationship: f.relationship,
    notes: f.notes,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  }));

  const consultations = consultationRows.map(mapConsultationAppointmentSummary);

  const prescriptions: SerializedPrescription[] = prescriptionRows.map((rx) => {
    const apptSlot = rx.appointment
      ? effectiveSlot({
          slotStart: rx.appointment.slotStart,
          slotEnd: rx.appointment.slotEnd,
          availability: rx.appointment.availability,
        })
      : null;
    return {
      id: rx.id,
      patientId: rx.patientId,
      doctorId: rx.doctorId,
      appointmentId: rx.appointmentId,
      diagnosis: rx.diagnosis,
      doctorName: rx.doctorNameSnapshot,
      doctorSpecialization: rx.doctorSpecializationSnapshot,
      prescribedAt: rx.prescribedAt.toISOString(),
      generalInstructions: rx.generalInstructions,
      lifestyleAdvice: rx.lifestyleAdvice,
      followUpRecommendation: rx.followUpRecommendation,
      followUpDate: rx.followUpDate ? rx.followUpDate.toISOString() : null,
      notes: rx.notes,
      appointmentSummary:
        rx.appointment && apptSlot
          ? {
              id: rx.appointment.id,
              tokenNumber: rx.appointment.tokenNumber,
              slotStart: apptSlot.start.toISOString(),
              slotEnd: apptSlot.end.toISOString(),
              subSlotLabel: formatSubSlotLabel({
                kind: rx.appointment.availability.kind,
                availabilityStart: rx.appointment.availability.startTime,
                availabilityEnd: rx.appointment.availability.endTime,
                slotStart: rx.appointment.slotStart,
                slotEnd: rx.appointment.slotEnd,
              }),
            }
          : null,
      medicines: rx.medicines.map((med) => ({
        id: med.id,
        sortOrder: med.sortOrder,
        medicineName: med.medicineName,
        dosage: med.dosage,
        route: med.route,
        frequency: med.frequency,
        duration: med.duration,
        quantity: med.quantity,
        instructions: med.instructions,
        notes: med.notes,
      })),
    };
  });

  const timeline = buildClinicalTimeline({
    allergies,
    conditions,
    medications,
    pastMedicalEntries,
    surgeries,
    familyHistories,
    consultations,
    prescriptions,
  });

  return {
    identity,
    hasAnyMedicalHistory: hasAnyPatientMedicalHistory({
      profile,
      allergies,
      conditions,
      medications,
      pastMedicalEntries,
      surgeries,
      familyHistories,
    }),
    profile,
    allergies,
    conditions,
    medications,
    pastMedicalEntries,
    surgeries,
    familyHistories,
    consultations,
    prescriptions,
    timeline,
  };
}
