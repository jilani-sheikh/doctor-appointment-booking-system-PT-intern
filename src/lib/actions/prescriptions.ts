"use server";

import { revalidatePath } from "next/cache";
import { NotificationType, Prisma, Role } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canDoctorIssuePrescription,
  canDoctorViewPatientRecord,
  DOCTOR_HISTORY_ELIGIBLE_STATUSES,
  DOCTOR_PRESCRIBE_ELIGIBLE_STATUSES,
} from "@/lib/medical-records";
import { loadCompletePatientMedicalRecord } from "@/lib/medical-records-server";
import { formatDoctorDisplayName } from "@/lib/queue-tokens";
import {
  createPrescriptionSchema,
  parseNullableDateUTC,
  type CreatePrescriptionInput,
} from "@/lib/validations/medical-records";

function revalidatePrescriptionPortals() {
  revalidatePath("/patient/medical-records");
  revalidatePath("/patient/dashboard");
  revalidatePath("/doctor/queue");
  revalidatePath("/doctor/appointments");
  revalidatePath("/notifications");
}

export async function getPatientMedicalRecordForDoctorAction(input: {
  patientId: string;
  appointmentId?: string | null;
}) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== Role.DOCTOR || !user.doctor) {
      return {
        success: false as const,
        error: "Unauthorized: Only authenticated doctors may view patient history.",
      };
    }

    const patientId = input.patientId?.trim();
    if (!patientId) {
      return { success: false as const, error: "Patient identifier is required." };
    }

    const appointmentId = input.appointmentId?.trim() || null;

    const [appointmentMatch, relationshipCount] = await Promise.all([
      appointmentId
        ? db.appointment.findUnique({
            where: { id: appointmentId },
            select: {
              id: true,
              patientId: true,
              status: true,
              availability: { select: { doctorId: true } },
            },
          })
        : Promise.resolve(null),
      db.appointment.count({
        where: {
          patientId,
          availability: { doctorId: user.doctor.id },
          status: { in: [...DOCTOR_HISTORY_ELIGIBLE_STATUSES] },
        },
      }),
    ]);

    const authDecision = canDoctorViewPatientRecord({
      callerRole: user.role,
      callerDoctorId: user.doctor.id,
      callerDoctorStatus: user.doctor.status,
      requestedPatientId: patientId,
      appointmentIdProvided: Boolean(appointmentId),
      appointmentMatch: appointmentMatch
        ? {
            id: appointmentMatch.id,
            doctorId: appointmentMatch.availability.doctorId,
            patientId: appointmentMatch.patientId,
            status: appointmentMatch.status,
          }
        : null,
      hasLegitimateRelationship: relationshipCount > 0,
    });

    if (!authDecision.allowed) {
      return { success: false as const, error: authDecision.reason };
    }

    const record = await loadCompletePatientMedicalRecord({
      patientId,
      appointmentId,
    });

    if (!record) {
      return { success: false as const, error: "Patient record could not be found." };
    }

    return { success: true as const, data: record };
  } catch (error) {
    const safeType = error instanceof Error ? error.name : "UnknownError";
    console.error(`[getPatientMedicalRecordForDoctorAction] Failed (${safeType})`);
    return {
      success: false as const,
      error: "Failed to load patient medical history.",
    };
  }
}

export async function createPrescriptionAction(input: CreatePrescriptionInput) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== Role.DOCTOR || !user.doctor) {
      return {
        success: false as const,
        error: "Unauthorized: Only authenticated doctors can issue prescriptions.",
      };
    }

    const parsed = createPrescriptionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Please complete all required prescription fields.",
      };
    }

    const {
      patientId,
      appointmentId,
      idempotencyKey,
      diagnosis,
      generalInstructions,
      lifestyleAdvice,
      followUpRecommendation,
      followUpDate,
      notes,
      medicines,
    } = parsed.data;

    const [patient, appointmentMatch, eligibleRelCount] = await Promise.all([
      db.patient.findUnique({
        where: { id: patientId },
        select: {
          id: true,
          userId: true,
          user: { select: { deletedAt: true } },
        },
      }),
      appointmentId
        ? db.appointment.findUnique({
            where: { id: appointmentId },
            select: {
              id: true,
              patientId: true,
              status: true,
              availability: { select: { doctorId: true } },
            },
          })
        : Promise.resolve(null),
      db.appointment.count({
        where: {
          patientId,
          availability: { doctorId: user.doctor.id },
          status: { in: [...DOCTOR_PRESCRIBE_ELIGIBLE_STATUSES] },
        },
      }),
    ]);

    if (!patient || patient.user.deletedAt) {
      return { success: false as const, error: "Target patient does not exist." };
    }

    const authDecision = canDoctorIssuePrescription({
      callerRole: user.role,
      callerDoctorId: user.doctor.id,
      callerDoctorStatus: user.doctor.status,
      requestedPatientId: patientId,
      appointmentIdProvided: Boolean(appointmentId),
      appointmentMatch: appointmentMatch
        ? {
            id: appointmentMatch.id,
            doctorId: appointmentMatch.availability.doctorId,
            patientId: appointmentMatch.patientId,
            status: appointmentMatch.status,
          }
        : null,
      hasEligibleRelationship: eligibleRelCount > 0,
    });

    if (!authDecision.allowed) {
      return { success: false as const, error: authDecision.reason };
    }

    const scopedIdempotencyKey = idempotencyKey
      ? `${user.doctor.id}:${patientId}:${idempotencyKey}`
      : null;

    // Check idempotency outside/before creation so retries never duplicate prescription or notifications
    if (scopedIdempotencyKey) {
      const existing = await db.prescription.findUnique({
        where: { idempotencyKey: scopedIdempotencyKey },
        select: { id: true, doctorId: true, patientId: true },
      });
      if (existing) {
        if (existing.doctorId === user.doctor.id && existing.patientId === patientId) {
          return {
            success: true as const,
            prescriptionId: existing.id,
            deduplicated: true,
            message: "Prescription already saved.",
          };
        }
        return {
          success: false as const,
          error: "Duplicate submission key conflict. Please refresh and try again.",
        };
      }
    }

    const doctorNameSnapshot = user.name?.trim() || "Practitioner";
    const doctorDisplayName = formatDoctorDisplayName(doctorNameSnapshot);
    const doctorSpecializationSnapshot = user.doctor.specialization;
    const parsedFollowUpDate = parseNullableDateUTC(followUpDate);
    const now = new Date();

    let createdPrescriptionId: string;
    try {
      const result = await db.$transaction(async (tx) => {
        const created = await tx.prescription.create({
          data: {
            patientId,
            doctorId: user.doctor!.id,
            appointmentId,
            idempotencyKey: scopedIdempotencyKey,
            diagnosis,
            doctorNameSnapshot,
            doctorSpecializationSnapshot,
            prescribedAt: now,
            generalInstructions,
            lifestyleAdvice,
            followUpRecommendation,
            followUpDate: parsedFollowUpDate,
            notes,
            medicines: {
              create: medicines.map((med, idx) => ({
                sortOrder: idx,
                medicineName: med.medicineName,
                dosage: med.dosage,
                route: med.route,
                frequency: med.frequency,
                duration: med.duration,
                quantity: med.quantity,
                instructions: med.instructions,
                notes: med.notes,
              })),
            },
          },
          select: { id: true },
        });

        await tx.notification.create({
          data: {
            userId: patient.userId,
            type: NotificationType.PRESCRIPTION_ISSUED,
            title: `New Prescription from ${doctorDisplayName}`,
            body: `${doctorDisplayName} issued a new prescription with ${medicines.length} medicine(s). Open Medical Records to view or print.`,
            href: `/patient/prescriptions/${created.id}`,
          },
        });

        return created.id;
      });
      createdPrescriptionId = result;
    } catch (error) {
      if (
        scopedIdempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await db.prescription.findUnique({
          where: { idempotencyKey: scopedIdempotencyKey },
          select: { id: true, doctorId: true, patientId: true },
        });
        if (existing && existing.doctorId === user.doctor.id && existing.patientId === patientId) {
          return {
            success: true as const,
            prescriptionId: existing.id,
            deduplicated: true,
            message: "Prescription already saved.",
          };
        }
      }
      throw error;
    }

    revalidatePrescriptionPortals();
    return {
      success: true as const,
      prescriptionId: createdPrescriptionId,
      deduplicated: false,
      message: "Prescription saved and sent to patient.",
    };
  } catch (error) {
    const safeType = error instanceof Error ? error.name : "UnknownError";
    console.error(`[createPrescriptionAction] Failed (${safeType})`);
    return {
      success: false as const,
      error: "Failed to save prescription.",
    };
  }
}
