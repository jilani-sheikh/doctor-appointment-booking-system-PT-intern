"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { getCurrentUser, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AppointmentStatus,
  RefundStatus,
  Role,
} from "@/generated/prisma/client";
import { sendEmail } from "@/lib/email/client";
import { updateDoctorAppointmentStatusAction } from "@/lib/actions/doctor-appointments";
import { getISTDateString, getISTDayRangeUTC } from "@/lib/time";
import { revalidatePath } from "next/cache";

const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE"),
  email: z.string().email().optional(),
  currentPassword: z.string().min(1).optional(),
});

function friendlyBlocker(message: string) {
  return { success: false as const, error: message };
}

export async function deleteAccountAction(input: {
  confirmation: string;
  email?: string;
  currentPassword?: string;
}) {
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return friendlyBlocker("Type DELETE exactly to confirm profile deletion.");

  const user = await getCurrentUser();
  if (!user || (user.role !== Role.PATIENT && user.role !== Role.DOCTOR)) {
    return friendlyBlocker("Only patient and doctor profiles can be deleted.");
  }

  const providerAccount = await db.account.findFirst({
    where: { userId: user.id, provider: "google" },
    select: { id: true },
  });
  if (providerAccount) {
    if (parsed.data.email?.trim().toLowerCase() !== user.email?.toLowerCase()) {
      return friendlyBlocker("Enter your account email to confirm deletion.");
    }
  } else if (!user.passwordHash || !parsed.data.currentPassword) {
    return friendlyBlocker("Enter your current password to confirm deletion.");
  } else if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return friendlyBlocker("The current password is incorrect.");
  }

  const now = new Date();
  const originalEmail = user.email;

  await db.user.updateMany({
    where: { id: user.id, deletedAt: null },
    data: { deletionRequestedAt: now },
  });

  if (user.role === Role.PATIENT && user.patient) {
    const active = await db.appointment.count({
      where: {
        patientId: user.patient.id,
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION] },
        availability: { endTime: { gt: now } },
      },
    });
    if (active > 0) return friendlyBlocker("Cancel all current or upcoming appointments before deleting your profile.");

    const holds = await db.appointment.count({
      where: { patientId: user.patient.id, status: AppointmentStatus.PENDING_PAYMENT },
    });
    if (holds > 0) return friendlyBlocker("Cancel your pending payment hold before deleting your profile.");

    const pendingRefunds = await db.refund.count({
      where: {
        appointment: { patientId: user.patient.id },
        status: { in: [RefundStatus.REQUESTED, RefundStatus.PENDING] },
      },
    });
    if (pendingRefunds > 0) return friendlyBlocker("Wait for pending refunds to finish before deleting your profile.");
  }

  let cancelledAppointments = 0;
  if (user.role === Role.DOCTOR && user.doctor) {
    const { start, nextDayStart } = getISTDayRangeUTC(getISTDateString(now));
    const todayBlocker = await db.appointment.count({
      where: {
        availability: { doctorId: user.doctor.id, startTime: { gte: start, lt: nextDayStart } },
        status: { in: [AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION] },
      },
    });
    if (todayBlocker > 0) return friendlyBlocker("Finish today’s checked-in or in-consultation appointments before deleting your profile.");

    const pendingRefunds = await db.refund.count({
      where: { appointment: { availability: { doctorId: user.doctor.id } }, status: { in: [RefundStatus.REQUESTED, RefundStatus.PENDING] } },
    });
    if (pendingRefunds > 0) return friendlyBlocker("Wait for pending refunds to finish before deleting your profile.");

    const upcoming = await db.appointment.findMany({
      where: {
        availability: { doctorId: user.doctor.id, startTime: { gt: now } },
        status: AppointmentStatus.CONFIRMED,
      },
      select: { id: true },
    });
    for (const appointment of upcoming) {
      const result = await updateDoctorAppointmentStatusAction(appointment.id, "CANCELLED");
      if (!result.success) return friendlyBlocker("Some upcoming appointments could not be cancelled. No profile data was deleted.");
      cancelledAppointments++;
    }
  }

  if (originalEmail) {
    try {
      await sendEmail({
        to: originalEmail,
        subject: "Your Medrella profile was deleted",
        html: "<p>Your Medrella profile was deleted as requested.</p>",
        text: "Your Medrella profile was deleted as requested.",
      });
    } catch (error) {
      console.error("[Delete Account] Final email failed:", error instanceof Error ? error.message : "unknown error");
    }
  }

  try {
    await db.$transaction(async (tx) => {
      const patientId = user.patient?.id;
      const doctorId = user.doctor?.id;
      const appointments = await tx.appointment.findMany({
        where: patientId
          ? { patientId }
          : {
              OR: [
                { availability: { doctorId: doctorId! } },
                { rescheduledFromAvailability: { doctorId: doctorId! } },
              ],
            },
        select: {
          id: true,
          availability: { select: { doctorId: true } },
          payments: { select: { id: true } },
          refunds: { select: { id: true } },
        },
      });
      const financialAppointmentIds = appointments
        .filter((appointment) => appointment.payments.length > 0 || appointment.refunds.length > 0)
        .map((appointment) => appointment.id);
      const hardDeleteAppointmentIds = appointments
        .filter(
          (appointment) =>
            (patientId || appointment.availability.doctorId === doctorId) &&
            appointment.payments.length === 0 &&
            appointment.refunds.length === 0
        )
        .map((appointment) => appointment.id);

      if (hardDeleteAppointmentIds.length > 0) {
        await tx.notificationDelivery.deleteMany({ where: { appointmentId: { in: hardDeleteAppointmentIds } } });
        await tx.appointment.deleteMany({ where: { id: { in: hardDeleteAppointmentIds } } });
      }

      if (patientId) {
        await tx.waitlistEntry.deleteMany({ where: { patientId } });
      } else if (doctorId) {
        await tx.waitlistEntry.deleteMany({ where: { doctorId } });
      }
      await tx.notificationDelivery.deleteMany({ where: { userId: user.id } });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.account.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });

      if (doctorId) {
        await tx.doctorTimeOff.deleteMany({ where: { doctorId } });
        const slots = await tx.availability.findMany({
          where: { doctorId },
          select: {
            id: true,
            appointments: { select: { id: true } },
            rescheduledAppointments: { select: { id: true } },
          },
        });
        const freeSlotIds = slots
          .filter(
            (slot) =>
              slot.appointments.length === 0 && slot.rescheduledAppointments.length === 0
          )
          .map((slot) => slot.id);
        if (freeSlotIds.length > 0) await tx.availability.deleteMany({ where: { id: { in: freeSlotIds } } });
        await tx.wave.deleteMany({ where: { doctorId, appointments: { none: {} } } });
      }

      if (financialAppointmentIds.length > 0) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            name: "Deleted user",
            email: `deleted+${user.id}@deleted.invalid`,
            image: null,
            passwordHash: null,
            passwordChangedAt: now,
            deletedAt: now,
            deletionRequestedAt: now,
          },
        });
        if (patientId) await tx.patient.update({ where: { id: patientId }, data: { dateOfBirth: null, gender: null, phone: null, whatsappOptIn: false, whatsappOptInAt: null } });
        if (doctorId) await tx.doctor.update({ where: { id: doctorId }, data: { specialization: "Deleted doctor", qualification: null, bio: null, consultationFee: 0, isDemo: false } });
      } else {
        if (patientId) await tx.patient.delete({ where: { id: patientId } });
        if (doctorId) await tx.doctor.delete({ where: { id: doctorId } });
        await tx.user.delete({ where: { id: user.id } });
      }
    }, { maxWait: 10000, timeout: 20000 });
  } catch (error) {
    console.error("[Delete Account] Deletion failed:", error instanceof Error ? error.message : "unknown error");
    return friendlyBlocker("Profile deletion could not be completed. No partial success is reported; please try again.");
  }

  revalidatePath("/");
  revalidatePath("/doctors");
  await signOut({ redirectTo: `/?deleted=1&cancelled=${cancelledAppointments}` });
}
