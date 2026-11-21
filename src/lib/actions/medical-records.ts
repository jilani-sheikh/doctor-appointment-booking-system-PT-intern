"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  allergySchema,
  conditionSchema,
  familyHistorySchema,
  medicationSchema,
  parseNullableDateUTC,
  pastMedicalEntrySchema,
  patientMedicalProfileSchema,
  surgerySchema,
  type AllergyInput,
  type ConditionInput,
  type FamilyHistoryInput,
  type MedicationInput,
  type PastMedicalEntryInput,
  type PatientMedicalProfileInput,
  type SurgeryInput,
} from "@/lib/validations/medical-records";

function revalidateMedicalViews() {
  revalidatePath("/patient/medical-records");
  revalidatePath("/patient/dashboard");
  revalidatePath("/doctor/queue");
  revalidatePath("/doctor/appointments");
}

function handleMedicalActionError(actionName: string, error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED_PATIENT") {
    return {
      success: false as const,
      error: "Unauthorized: Only authenticated patients can manage their medical profile.",
    };
  }
  const safeErrorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[${actionName}] Failed (${safeErrorType})`);
  return { success: false as const, error: fallbackMessage };
}

function validateRecordId(id: string): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

async function requireAuthenticatedPatientId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user || user.role !== Role.PATIENT || !user.patient) {
    throw new Error("UNAUTHORIZED_PATIENT");
  }
  return user.patient.id;
}

export async function upsertPatientMedicalProfileAction(input: PatientMedicalProfileInput) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const parsed = patientMedicalProfileSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid medical profile details.",
      };
    }

    await db.patientMedicalProfile.upsert({
      where: { patientId },
      create: { patientId, ...parsed.data },
      update: parsed.data,
    });

    revalidateMedicalViews();
    return { success: true as const, message: "Medical overview details saved." };
  } catch (error) {
    return handleMedicalActionError(
      "upsertPatientMedicalProfileAction",
      error,
      "Failed to save medical overview details."
    );
  }
}

export async function savePatientAllergyAction(input: AllergyInput) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const parsed = allergySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid allergy details.",
      };
    }

    const { id, ...fields } = parsed.data;
    if (id) {
      const updated = await db.patientAllergy.updateMany({
        where: { id, patientId },
        data: fields,
      });
      if (updated.count !== 1) {
        return { success: false as const, error: "Allergy record not found." };
      }
    } else {
      await db.patientAllergy.create({
        data: { patientId, ...fields },
      });
    }

    revalidateMedicalViews();
    return {
      success: true as const,
      message: id ? "Allergy updated." : "Allergy added to your medical profile.",
    };
  } catch (error) {
    return handleMedicalActionError(
      "savePatientAllergyAction",
      error,
      "Failed to save allergy record."
    );
  }
}

export async function deletePatientAllergyAction(id: string) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const recordId = validateRecordId(id);
    if (!recordId) {
      return { success: false as const, error: "Invalid allergy record identifier." };
    }
    const deleted = await db.patientAllergy.deleteMany({
      where: { id: recordId, patientId },
    });
    if (deleted.count !== 1) {
      return { success: false as const, error: "Allergy record not found." };
    }
    revalidateMedicalViews();
    return { success: true as const, message: "Allergy removed." };
  } catch (error) {
    return handleMedicalActionError(
      "deletePatientAllergyAction",
      error,
      "Failed to remove allergy record."
    );
  }
}

export async function savePatientConditionAction(input: ConditionInput) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const parsed = conditionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid medical condition details.",
      };
    }

    const { id, diagnosedDate, ...rest } = parsed.data;
    const data = {
      ...rest,
      diagnosedDate: parseNullableDateUTC(diagnosedDate),
    };

    if (id) {
      const updated = await db.patientCondition.updateMany({
        where: { id, patientId },
        data,
      });
      if (updated.count !== 1) {
        return { success: false as const, error: "Medical condition record not found." };
      }
    } else {
      await db.patientCondition.create({
        data: { patientId, ...data },
      });
    }

    revalidateMedicalViews();
    return {
      success: true as const,
      message: id ? "Medical condition updated." : "Medical condition added.",
    };
  } catch (error) {
    return handleMedicalActionError(
      "savePatientConditionAction",
      error,
      "Failed to save medical condition."
    );
  }
}

export async function deletePatientConditionAction(id: string) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const recordId = validateRecordId(id);
    if (!recordId) {
      return { success: false as const, error: "Invalid medical condition identifier." };
    }
    const deleted = await db.patientCondition.deleteMany({
      where: { id: recordId, patientId },
    });
    if (deleted.count !== 1) {
      return { success: false as const, error: "Medical condition record not found." };
    }
    revalidateMedicalViews();
    return { success: true as const, message: "Medical condition removed." };
  } catch (error) {
    return handleMedicalActionError(
      "deletePatientConditionAction",
      error,
      "Failed to remove medical condition."
    );
  }
}

export async function savePatientMedicationAction(input: MedicationInput) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const parsed = medicationSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid medication details.",
      };
    }

    const { id, startDate, endDate, ...rest } = parsed.data;
    const data = {
      ...rest,
      startDate: parseNullableDateUTC(startDate),
      endDate: parseNullableDateUTC(endDate),
    };

    if (id) {
      const updated = await db.patientMedication.updateMany({
        where: { id, patientId },
        data,
      });
      if (updated.count !== 1) {
        return { success: false as const, error: "Medication record not found." };
      }
    } else {
      await db.patientMedication.create({
        data: { patientId, ...data },
      });
    }

    revalidateMedicalViews();
    return {
      success: true as const,
      message: id ? "Medication updated." : "Medication added.",
    };
  } catch (error) {
    return handleMedicalActionError(
      "savePatientMedicationAction",
      error,
      "Failed to save medication record."
    );
  }
}

export async function deletePatientMedicationAction(id: string) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const recordId = validateRecordId(id);
    if (!recordId) {
      return { success: false as const, error: "Invalid medication record identifier." };
    }
    const deleted = await db.patientMedication.deleteMany({
      where: { id: recordId, patientId },
    });
    if (deleted.count !== 1) {
      return { success: false as const, error: "Medication record not found." };
    }
    revalidateMedicalViews();
    return { success: true as const, message: "Medication removed." };
  } catch (error) {
    return handleMedicalActionError(
      "deletePatientMedicationAction",
      error,
      "Failed to remove medication record."
    );
  }
}

export async function savePatientPastMedicalEntryAction(input: PastMedicalEntryInput) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const parsed = pastMedicalEntrySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid past medical history details.",
      };
    }

    const { id, recordedDate, ...rest } = parsed.data;
    const data = {
      ...rest,
      recordedDate: parseNullableDateUTC(recordedDate),
    };

    if (id) {
      const updated = await db.patientPastMedicalEntry.updateMany({
        where: { id, patientId },
        data,
      });
      if (updated.count !== 1) {
        return { success: false as const, error: "Past medical history entry not found." };
      }
    } else {
      await db.patientPastMedicalEntry.create({
        data: { patientId, ...data },
      });
    }

    revalidateMedicalViews();
    return {
      success: true as const,
      message: id ? "Past medical entry updated." : "Past medical entry added.",
    };
  } catch (error) {
    return handleMedicalActionError(
      "savePatientPastMedicalEntryAction",
      error,
      "Failed to save past medical history."
    );
  }
}

export async function deletePatientPastMedicalEntryAction(id: string) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const recordId = validateRecordId(id);
    if (!recordId) {
      return { success: false as const, error: "Invalid past medical entry identifier." };
    }
    const deleted = await db.patientPastMedicalEntry.deleteMany({
      where: { id: recordId, patientId },
    });
    if (deleted.count !== 1) {
      return { success: false as const, error: "Past medical history entry not found." };
    }
    revalidateMedicalViews();
    return { success: true as const, message: "Past medical entry removed." };
  } catch (error) {
    return handleMedicalActionError(
      "deletePatientPastMedicalEntryAction",
      error,
      "Failed to remove past medical history."
    );
  }
}

export async function savePatientSurgeryAction(input: SurgeryInput) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const parsed = surgerySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid surgical history details.",
      };
    }

    const { id, surgeryDate, ...rest } = parsed.data;
    const data = {
      ...rest,
      surgeryDate: parseNullableDateUTC(surgeryDate),
    };

    if (id) {
      const updated = await db.patientSurgery.updateMany({
        where: { id, patientId },
        data,
      });
      if (updated.count !== 1) {
        return { success: false as const, error: "Surgical history record not found." };
      }
    } else {
      await db.patientSurgery.create({
        data: { patientId, ...data },
      });
    }

    revalidateMedicalViews();
    return {
      success: true as const,
      message: id ? "Surgical record updated." : "Surgical record added.",
    };
  } catch (error) {
    return handleMedicalActionError(
      "savePatientSurgeryAction",
      error,
      "Failed to save surgical history."
    );
  }
}

export async function deletePatientSurgeryAction(id: string) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const recordId = validateRecordId(id);
    if (!recordId) {
      return { success: false as const, error: "Invalid surgical record identifier." };
    }
    const deleted = await db.patientSurgery.deleteMany({
      where: { id: recordId, patientId },
    });
    if (deleted.count !== 1) {
      return { success: false as const, error: "Surgical history record not found." };
    }
    revalidateMedicalViews();
    return { success: true as const, message: "Surgical record removed." };
  } catch (error) {
    return handleMedicalActionError(
      "deletePatientSurgeryAction",
      error,
      "Failed to remove surgical history."
    );
  }
}

export async function savePatientFamilyHistoryAction(input: FamilyHistoryInput) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const parsed = familyHistorySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid family medical history details.",
      };
    }

    const { id, ...fields } = parsed.data;
    if (id) {
      const updated = await db.patientFamilyHistory.updateMany({
        where: { id, patientId },
        data: fields,
      });
      if (updated.count !== 1) {
        return { success: false as const, error: "Family history record not found." };
      }
    } else {
      await db.patientFamilyHistory.create({
        data: { patientId, ...fields },
      });
    }

    revalidateMedicalViews();
    return {
      success: true as const,
      message: id ? "Family history updated." : "Family history added.",
    };
  } catch (error) {
    return handleMedicalActionError(
      "savePatientFamilyHistoryAction",
      error,
      "Failed to save family history."
    );
  }
}

export async function deletePatientFamilyHistoryAction(id: string) {
  try {
    const patientId = await requireAuthenticatedPatientId();
    const recordId = validateRecordId(id);
    if (!recordId) {
      return { success: false as const, error: "Invalid family history identifier." };
    }
    const deleted = await db.patientFamilyHistory.deleteMany({
      where: { id: recordId, patientId },
    });
    if (deleted.count !== 1) {
      return { success: false as const, error: "Family history record not found." };
    }
    revalidateMedicalViews();
    return { success: true as const, message: "Family history removed." };
  } catch (error) {
    return handleMedicalActionError(
      "deletePatientFamilyHistoryAction",
      error,
      "Failed to remove family history."
    );
  }
}
