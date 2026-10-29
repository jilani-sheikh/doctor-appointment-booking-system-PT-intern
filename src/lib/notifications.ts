import { db } from "@/lib/db";
import { NotificationType, type Notification } from "@/generated/prisma/client";
import { calculateQueueEstimates, type QueueAppointmentItem } from "@/lib/queue";
import { getTodayISTDateString, getISTDateString } from "@/lib/time";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
}

/**
 * Creates a single in-app notification for a user.
 */
export async function createNotification(input: CreateNotificationInput): Promise<Notification> {
  return await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
    },
  });
}

/**
 * Creates multiple in-app notifications in a single batch.
 */
export async function createManyNotifications(inputs: CreateNotificationInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const res = await db.notification.createMany({
    data: inputs.map((item) => ({
      userId: item.userId,
      type: item.type,
      title: item.title,
      body: item.body,
      href: item.href ?? null,
    })),
  });
  return res.count;
}

/**
 * Checks for queue delays exceeding 20 minutes for a doctor's consultations today
 * and sends QUEUE_DELAY notifications to affected patients at most once per appointment per day.
 *
 * Triggered from consultation start/end actions (strictly NOT during page renders).
 */
export async function checkAndNotifyQueueDelay(doctorId: string): Promise<number> {
  try {
    const todayIST = getTodayISTDateString();
    const now = new Date();

    const doctor = await db.doctor.findUnique({
      where: { id: doctorId },
      include: {
        user: { select: { name: true } },
      },
    });

    if (!doctor) return 0;

    // Fetch today's appointments for this doctor
    const rawAppointments = await db.appointment.findMany({
      where: {
        availability: { doctorId },
      },
      include: {
        availability: true,
        patient: { select: { id: true, userId: true } },
      },
      orderBy: {
        availability: { startTime: "asc" },
      },
    });

    // Filter appointments for today IST
    const todayAppts = rawAppointments.filter(
      (a) => getISTDateString(a.availability.startTime) === todayIST
    );

    const queueItems: QueueAppointmentItem[] = todayAppts.map((a) => ({
      id: a.id,
      status: a.status,
      scheduledStart: a.availability.startTime,
      scheduledEnd: a.availability.endTime,
      actualStartAt: a.actualStartAt,
      actualEndAt: a.actualEndAt,
      checkedInAt: a.checkedInAt,
    }));

    const estimates = calculateQueueEstimates(queueItems, now);
    let notifiedCount = 0;

    for (const appt of todayAppts) {
      const est = estimates.get(appt.id);
      if (!est) continue;

      // Rule: Delay exceeds 20 minutes
      if (est.delayMinutes > 20) {
        // Send at most once per appointment per day
        const alreadyNotifiedToday =
          appt.delayNotifiedAt && getISTDateString(appt.delayNotifiedAt) === todayIST;

        if (!alreadyNotifiedToday) {
          const doctorName = doctor.user.name ?? "Practitioner";

          await db.$transaction(async (tx) => {
            await tx.notification.create({
              data: {
                userId: appt.patient.userId,
                type: NotificationType.QUEUE_DELAY,
                title: "Consultation Queue Delay",
                body: `Dr. ${doctorName} is running approximately ${est.roundedDelayMinutes} minutes behind schedule. Your estimated consultation time has been adjusted.`,
                href: "/patient/appointments",
              },
            });

            await tx.appointment.update({
              where: { id: appt.id },
              data: {
                delayNotifiedAt: now,
              },
            });
          });

          notifiedCount++;
        }
      }
    }

    return notifiedCount;
  } catch (error) {
    console.error("[checkAndNotifyQueueDelay] Error evaluating queue delay notifications:", error);
    return 0;
  }
}
