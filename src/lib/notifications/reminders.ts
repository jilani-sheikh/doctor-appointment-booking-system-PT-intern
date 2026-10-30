import { AppointmentStatus, DeliveryStatus, NotificationChannel, type Prisma } from "@/generated/prisma/client";
import { getReminderOffsetsMinutes, getWhatsAppMode } from "@/lib/env";

export interface SyncRemindersParams {
  appointmentId: string;
  userId: string;
  slotStartTime: Date;
  slotEndTime?: Date;
  status: AppointmentStatus;
  now?: Date;
}

/**
 * Shared helper to synchronize appointment reminder outbox deliveries across all status changes and reschedules.
 * - When CANCELLED, NO_SHOW, COMPLETED: pending reminders are marked CANCELLED.
 * - When CHECKED_IN: pending reminders are marked SKIPPED.
 * - When CONFIRMED: pending reminders are re-synchronized for upcoming reminder offsets.
 */
export async function syncAppointmentReminders(
  tx: Prisma.TransactionClient,
  params: SyncRemindersParams
): Promise<{ cancelled: number; skipped: number; scheduled: number }> {
  const { appointmentId, userId, slotStartTime, status, now = new Date() } = params;

  // 1. Terminal / Disrupted statuses: Cancel all pending reminders
  if (
    status === AppointmentStatus.CANCELLED ||
    status === AppointmentStatus.NO_SHOW ||
    status === AppointmentStatus.COMPLETED
  ) {
    const res = await tx.notificationDelivery.updateMany({
      where: {
        appointmentId,
        template: { in: ["reminder", "appointment_reminder"] },
        status: DeliveryStatus.PENDING,
      },
      data: {
        status: DeliveryStatus.CANCELLED,
      },
    });
    return { cancelled: res.count, skipped: 0, scheduled: 0 };
  }

  // 2. CHECKED_IN: Patient has already arrived; skip any future reminders
  if (status === AppointmentStatus.CHECKED_IN || status === AppointmentStatus.IN_CONSULTATION) {
    const res = await tx.notificationDelivery.updateMany({
      where: {
        appointmentId,
        template: { in: ["reminder", "appointment_reminder"] },
        status: DeliveryStatus.PENDING,
      },
      data: {
        status: DeliveryStatus.SKIPPED,
      },
    });
    return { cancelled: 0, skipped: res.count, scheduled: 0 };
  }

  // 3. CONFIRMED: Cancel any previous pending reminders (in case of reschedule) and schedule new ones
  await tx.notificationDelivery.updateMany({
    where: {
      appointmentId,
      template: { in: ["reminder", "appointment_reminder"] },
      status: DeliveryStatus.PENDING,
    },
    data: {
      status: DeliveryStatus.CANCELLED,
    },
  });

  const offsets = getReminderOffsetsMinutes();
  let scheduledCount = 0;
  const patient = "user" in tx && tx.user
    ? await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, patient: { select: { whatsappOptIn: true } } },
      })
    : null;
  const shouldScheduleWhatsApp =
    getWhatsAppMode() === "twilio" && patient?.role === "PATIENT" && patient.patient?.whatsappOptIn;

  for (const offset of offsets) {
    const scheduledFor = new Date(slotStartTime.getTime() - offset * 60 * 1000);

    // Only schedule if the reminder time is in the future
    if (scheduledFor > now) {
      const dedupeKey = `reminder:${appointmentId}:${offset}:${slotStartTime.getTime()}`;

      await tx.notificationDelivery.upsert({
        where: { dedupeKey },
        create: {
          userId,
          appointmentId,
          channel: NotificationChannel.EMAIL,
          template: "reminder",
          payload: {
            offsetMinutes: offset,
            slotStartTime: slotStartTime.toISOString(),
            ...(params.slotEndTime ? { slotEndTime: params.slotEndTime.toISOString() } : {}),
          },
          dedupeKey,
          scheduledFor,
          status: DeliveryStatus.PENDING,
        },
        update: {
          scheduledFor,
          status: DeliveryStatus.PENDING,
        },
      });

      if (shouldScheduleWhatsApp) {
        await tx.notificationDelivery.upsert({
          where: { dedupeKey: `whatsapp:appointment_reminder:${appointmentId}:${offset}:${slotStartTime.getTime()}` },
          create: {
            userId,
            appointmentId,
            channel: NotificationChannel.WHATSAPP,
            template: "appointment_reminder",
            payload: {
              doctorName: "Practitioner",
              startTime: slotStartTime.toISOString(),
              ...(params.slotEndTime ? { endTime: params.slotEndTime.toISOString() } : {}),
              offsetMinutes: offset,
            },
            dedupeKey: `whatsapp:appointment_reminder:${appointmentId}:${offset}:${slotStartTime.getTime()}`,
            scheduledFor,
            status: DeliveryStatus.PENDING,
          },
          update: { scheduledFor, status: DeliveryStatus.PENDING },
        });
      }

      scheduledCount++;
    }
  }

  return { cancelled: 0, skipped: 0, scheduled: scheduledCount };
}
