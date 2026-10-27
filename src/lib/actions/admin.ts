"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, DoctorStatus } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";

/**
 * Administrative action to approve or reject a medical practitioner.
 * Enforces:
 * - Admin authorization
 * - Revalidates directory and doctor routes
 */
export async function updateDoctorApprovalAction(
  doctorId: string,
  newStatus: "APPROVED" | "REJECTED"
) {
  await requireRole(Role.ADMIN);

  const doctor = await db.doctor.findUnique({
    where: { id: doctorId },
    include: {
      user: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!doctor) {
    return { success: false, error: "Doctor record not found." };
  }

  await db.doctor.update({
    where: { id: doctorId },
    data: {
      status: newStatus as DoctorStatus,
    },
  });

  revalidatePath("/admin/doctors");
  revalidatePath("/admin/dashboard");
  revalidatePath("/doctors");
  revalidatePath(`/doctors/${doctorId}`);
  revalidatePath("/doctor/dashboard");
  revalidatePath("/doctor/slots");

  return {
    success: true,
    message: `Dr. ${doctor.user.name ?? "Practitioner"} has been ${newStatus.toLowerCase()}.`,
  };
}
