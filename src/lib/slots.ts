import { db } from "@/lib/db";
import { NotificationType, Prisma, SlotStatus } from "@/generated/prisma/client";
import { formatDateTimeIST } from "@/lib/time";

export interface ReleaseSlotResult {
  availabilityId: string;
  doctorId: string;
  startTime: Date;
  endTime: Date;
  newStatus: SlotStatus;
  newlyAvailable: boolean;
  blockedByTimeOffId: string | null;
}

type DbOrTxClient = Prisma.TransactionClient | typeof db;

/**
 * Shared slot-release helper.
 * Used by:
 * - Patient appointment cancel
 * - Doctor appointment cancel
 * - Patient/Doctor reschedule (releasing previous slot)
 * - Doctor time-off deletion (restoring slots)
 *
 * Rule (Promt5.md Amendments 1 & 2):
 * Sets the slot to AVAILABLE, UNLESS it falls inside an active DoctorTimeOff,
 * in which case it sets BLOCKED and records blockedByTimeOffId.
 */
export async function releaseSlot(
  client: DbOrTxClient,
  availabilityId: string
): Promise<ReleaseSlotResult> {
  const slot = await client.availability.findUnique({
    where: { id: availabilityId },
    select: {
      id: true,
      doctorId: true,
      startTime: true,
      endTime: true,
      kind: true,
      status: true,
      capacity: true,
      activeCount: true,
      parent: {
        select: {
          startTime: true,
          endTime: true,
          status: true,
        },
      },
      schedule: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!slot) {
    throw new Error(`Availability slot not found: ${availabilityId}`);
  }

  // Never reactivate a WAVE_SLOT that falls outside its shrunk WAVE_PARENT window or belongs to a cancelled schedule
  const isShrunkWaveChild =
    slot.kind === "WAVE_SLOT" &&
    slot.parent != null &&
    (slot.startTime < slot.parent.startTime ||
      slot.endTime > slot.parent.endTime ||
      slot.parent.status === SlotStatus.BLOCKED);
  const isCancelledSchedule = slot.schedule?.status === "CANCELLED";

  if (isShrunkWaveChild || isCancelledSchedule) {
    await client.$executeRaw`
      UPDATE "availabilities"
      SET "active_count" = GREATEST("active_count" - 1, 0),
          "status" = 'BLOCKED'::"SlotStatus"
      WHERE "id" = ${availabilityId}
    `;

    return {
      availabilityId: slot.id,
      doctorId: slot.doctorId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      newStatus: SlotStatus.BLOCKED,
      newlyAvailable: false,
      blockedByTimeOffId: null,
    };
  }

  // Check if slot overlaps any active doctor time-off
  const overlappingTimeOff = await client.doctorTimeOff.findFirst({
    where: {
      doctorId: slot.doctorId,
      startAt: { lt: slot.endTime },
      endAt: { gt: slot.startTime },
    },
  });

  if (overlappingTimeOff) {
    // Slot remains or becomes BLOCKED due to active doctor absence
    await client.$executeRaw`
      UPDATE "availabilities"
      SET "active_count" = GREATEST("active_count" - 1, 0),
          "status" = 'BLOCKED'::"SlotStatus",
          "blocked_by_time_off_id" = ${overlappingTimeOff.id}
      WHERE "id" = ${availabilityId}
    `;

    return {
      availabilityId: slot.id,
      doctorId: slot.doctorId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      newStatus: SlotStatus.BLOCKED,
      newlyAvailable: false,
      blockedByTimeOffId: overlappingTimeOff.id,
    };
  }

  const updated = await client.$executeRaw`
    UPDATE "availabilities"
    SET "active_count" = GREATEST("active_count" - 1, 0),
        "status" = CASE
          WHEN GREATEST("active_count" - 1, 0) < "capacity" THEN 'AVAILABLE'::"SlotStatus"
          ELSE "status"
        END,
        "blocked_by_time_off_id" = NULL
    WHERE "id" = ${availabilityId}
  `;

  return {
    availabilityId: slot.id,
    doctorId: slot.doctorId,
    startTime: slot.startTime,
    endTime: slot.endTime,
    newStatus: SlotStatus.AVAILABLE,
    newlyAvailable: updated > 0 && slot.activeCount >= slot.capacity,
    blockedByTimeOffId: null,
  };
}

/**
 * Dispatches SLOT_AVAILABLE notifications to matching waitlist entries after a slot returns to AVAILABLE.
 * Executed after the releasing transaction commits.
 */
export async function notifyWaitlistAfterSlotRelease(
  doctorId: string,
  slotStartTime: Date
): Promise<number> {
  try {
    const doctor = await db.doctor.findUnique({
      where: { id: doctorId },
      include: {
        user: { select: { name: true } },
      },
    });

    if (!doctor) return 0;

    // Find all patients on this doctor's waitlist whose window covers this slot
    const matchingEntries = await db.waitlistEntry.findMany({
      where: {
        doctorId,
        earliestDate: { lte: slotStartTime },
        latestDate: { gte: slotStartTime },
        notifiedAt: null, // Nudge unnotified patients
      },
      include: {
        patient: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (matchingEntries.length === 0) return 0;

    const doctorName = doctor.user.name ?? "Practitioner";
    const slotFormatted = formatDateTimeIST(slotStartTime);

    // Create notifications for all matching waitlisted patients
    await db.notification.createMany({
      data: matchingEntries.map((entry) => ({
        userId: entry.patient.userId,
        type: NotificationType.SLOT_AVAILABLE,
        title: "Consultation Slot Available",
        body: `A consultation slot with Dr. ${doctorName} on ${slotFormatted} has just become available.`,
        href: `/doctors/${doctorId}`,
      })),
    });

    // Mark waitlist entries as notified
    await db.waitlistEntry.updateMany({
      where: {
        id: { in: matchingEntries.map((e) => e.id) },
      },
      data: {
        notifiedAt: new Date(),
      },
    });

    return matchingEntries.length;
  } catch (error) {
    console.error("[notifyWaitlistAfterSlotRelease] Failed to notify waitlisted patients:", error);
    return 0;
  }
}
