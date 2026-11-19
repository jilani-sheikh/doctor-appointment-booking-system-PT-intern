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

/**
 * Administrative action to assign or revoke the RECEPTIONIST role on a user account.
 * Restricts granting to unassigned (role === null) non-patient/non-doctor accounts
 * so clinical or administrative accounts cannot be silently overwritten.
 */
export async function updateReceptionistRoleAction(
  targetUserId: string,
  enable: boolean
) {
  const admin = await requireRole(Role.ADMIN);

  if (!targetUserId || targetUserId === admin.id) {
    return { success: false, error: "Invalid user selected." };
  }

  const targetUser = await db.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      deletedAt: true,
      patient: { select: { id: true } },
      doctor: { select: { id: true } },
    },
  });

  if (!targetUser || targetUser.deletedAt) {
    return { success: false, error: "User account not found." };
  }

  if (enable) {
    if (targetUser.role !== null || targetUser.patient || targetUser.doctor) {
      return {
        success: false,
        error: "Only newly registered unassigned users can be assigned the Receptionist role.",
      };
    }

    const updated = await db.user.updateMany({
      where: {
        id: targetUserId,
        role: null,
        deletedAt: null,
      },
      data: { role: Role.RECEPTIONIST },
    });

    if (updated.count !== 1) {
      return {
        success: false,
        error: "User role was updated concurrently. Please refresh.",
      };
    }
  } else {
    if (targetUser.role !== Role.RECEPTIONIST) {
      return {
        success: false,
        error: "Only Receptionist role assignments can be revoked from this action.",
      };
    }

    const now = new Date();
    const revokedCount = await db.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: targetUserId,
          role: Role.RECEPTIONIST,
          deletedAt: null,
        },
        data: {
          role: null,
          passwordChangedAt: now,
        },
      });
      if (updated.count === 1) {
        await tx.session.deleteMany({
          where: { userId: targetUserId },
        });
      }
      return updated.count;
    });

    if (revokedCount !== 1) {
      return {
        success: false,
        error: "User role was updated concurrently. Please refresh.",
      };
    }
  }

  revalidatePath("/admin/dashboard");
  revalidatePath("/receptionist");

  const label = targetUser.name || targetUser.email || "User";
  return {
    success: true,
    message: enable
      ? `${label} assigned as Receptionist.`
      : `Receptionist role revoked for ${label}.`,
  };
}
