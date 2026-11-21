import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth";
import {
  createPrismaCheckInClient,
  executeCheckInTransaction,
  type CheckInResult,
  type StaffCheckInResult,
} from "@/lib/check-in-core";
import { db } from "@/lib/db";

export type { CheckInResult, StaffCheckInResult };

/**
 * Shared atomic check-in service used by Patient self check-in,
 * Receptionist Check In, and Admin override.
 * Serializes concurrent arrival updates via `FOR UPDATE` + conditional status update (`CONFIRMED -> CHECKED_IN`).
 */
export async function markAppointmentArrived(input: {
  appointmentId: string;
  actor: CurrentUser;
  expectedDoctorId?: string;
  expectedAvailabilityId?: string;
}): Promise<CheckInResult> {
  try {
    return await db.$transaction(
      async (tx) =>
        executeCheckInTransaction(createPrismaCheckInClient(tx), {
          appointmentId: input.appointmentId,
          expectedDoctorId: input.expectedDoctorId,
          expectedAvailabilityId: input.expectedAvailabilityId,
          actor: {
            id: input.actor.id,
            role: input.actor.role,
            patientId: input.actor.patient?.id ?? null,
            doctor: input.actor.doctor
              ? { id: input.actor.doctor.id, status: input.actor.doctor.status }
              : null,
          },
        }),
      { maxWait: 10000, timeout: 20000 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      console.error("[markAppointmentArrived] Transaction timeout:", error);
      return { success: false, error: "The check-in request timed out. Please try again." };
    }
    console.error("[markAppointmentArrived] Unexpected error:", error);
    return { success: false, error: "Failed to record check-in." };
  }
}
