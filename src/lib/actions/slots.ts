"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { bulkSlotSchema, type BulkSlotInput } from "@/lib/validations/slots";
import { Role, DoctorStatus, SlotStatus } from "@/generated/prisma/client";
import { parseISTDateTime, getTodayISTDateString } from "@/lib/time";
import { revalidatePath } from "next/cache";

/**
 * Generates slots within the specified date range and time window for the authenticated approved doctor.
 */
export async function createBulkSlotsAction(input: BulkSlotInput) {
  const user = await requireRole(Role.DOCTOR);

  if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) {
    return {
      success: false,
      error: "Only approved doctors can manage and generate appointment slots.",
    };
  }

  const parsed = bulkSlotSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.errors[0]?.message ?? "Invalid slot parameters.",
    };
  }

  const { startDate, endDate, daysOfWeek, startTime, endTime, duration } = parsed.data;
  const doctorId = user.doctor.id;
  const now = new Date();

  // Generate date list
  const startD = new Date(`${startDate}T00:00:00Z`);
  const endD = new Date(`${endDate}T00:00:00Z`);
  const dayMillis = 24 * 60 * 60 * 1000;

  const candidateSlots: { doctorId: string; startTime: Date; endTime: Date; status: SlotStatus }[] = [];

  for (let current = startD.getTime(); current <= endD.getTime(); current += dayMillis) {
    const curDate = new Date(current);
    const dateStr = curDate.toISOString().slice(0, 10);
    // In IST, what day of week is this dateStr?
    // Parse midday IST to reliably extract UTC day of week for that calendar date
    const probe = parseISTDateTime(dateStr, "12:00");
    // Probe's day of week in IST:
    const istOffset = 5.5 * 60 * 60 * 1000;
    const probeIST = new Date(probe.getTime() + istOffset);
    const dayOfWeek = probeIST.getUTCDay();

    if (!daysOfWeek.includes(dayOfWeek)) {
      continue;
    }

    // Parse start and end time components
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);

    let curMinute = startH * 60 + startM;
    const endMinute = endH * 60 + endM;

    while (curMinute + duration <= endMinute) {
      const slotStartH = Math.floor(curMinute / 60);
      const slotStartM = curMinute % 60;
      const slotEndH = Math.floor((curMinute + duration) / 60);
      const slotEndM = (curMinute + duration) % 60;

      const slotStartTimeStr = `${String(slotStartH).padStart(2, "0")}:${String(slotStartM).padStart(2, "0")}`;
      const slotEndTimeStr = `${String(slotEndH).padStart(2, "0")}:${String(slotEndM).padStart(2, "0")}`;

      const slotStartUtc = parseISTDateTime(dateStr, slotStartTimeStr);
      const slotEndUtc = parseISTDateTime(dateStr, slotEndTimeStr);

      // Do not generate slots in the past
      if (slotStartUtc > now) {
        candidateSlots.push({
          doctorId,
          startTime: slotStartUtc,
          endTime: slotEndUtc,
          status: SlotStatus.AVAILABLE,
        });
      }

      curMinute += duration;
    }
  }

  if (candidateSlots.length === 0) {
    return {
      success: true,
      createdCount: 0,
      skippedCount: 0,
      message: "No future slots could be generated with the chosen criteria.",
    };
  }

  // Find min and max timestamp to query existing slots for overlap
  const minTime = candidateSlots[0].startTime;
  const maxTime = candidateSlots[candidateSlots.length - 1].endTime;

  const existingSlots = await db.availability.findMany({
    where: {
      doctorId,
      startTime: { gte: minTime, lte: maxTime },
    },
    select: {
      startTime: true,
      endTime: true,
    },
  });

  // Filter out slots that overlap with any existing slot
  const nonOverlappingSlots: typeof candidateSlots = [];
  let skippedCount = 0;

  for (const candidate of candidateSlots) {
    const hasOverlap = existingSlots.some((existing) => {
      return (
        candidate.startTime.getTime() < existing.endTime.getTime() &&
        candidate.endTime.getTime() > existing.startTime.getTime()
      );
    });

    if (hasOverlap) {
      skippedCount++;
    } else {
      nonOverlappingSlots.push(candidate);
    }
  }

  if (nonOverlappingSlots.length > 0) {
    await db.availability.createMany({
      data: nonOverlappingSlots,
      skipDuplicates: true,
    });
  }

  revalidatePath("/doctor/slots");
  revalidatePath("/doctor/dashboard");
  revalidatePath("/doctors");

  return {
    success: true,
    createdCount: nonOverlappingSlots.length,
    skippedCount,
    message: `Created ${nonOverlappingSlots.length} slot(s). ${skippedCount > 0 ? `${skippedCount} overlapping slot(s) skipped.` : ""}`,
  };
}

/**
 * Toggles a slot's availability between AVAILABLE and BLOCKED.
 */
export async function toggleBlockSlotAction(slotId: string) {
  const user = await requireRole(Role.DOCTOR);

  if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can manage slots." };
  }

  const slot = await db.availability.findUnique({
    where: { id: slotId },
  });

  if (!slot || slot.doctorId !== user.doctor.id) {
    return { success: false, error: "Slot not found or unauthorized." };
  }

  if (slot.status === SlotStatus.BOOKED) {
    return { success: false, error: "Booked slots cannot be modified." };
  }

  const newStatus = slot.status === SlotStatus.AVAILABLE ? SlotStatus.BLOCKED : SlotStatus.AVAILABLE;

  await db.availability.update({
    where: { id: slotId },
    data: { status: newStatus },
  });

  revalidatePath("/doctor/slots");
  revalidatePath("/doctor/dashboard");
  revalidatePath("/doctors");

  return {
    success: true,
    newStatus,
    message: `Slot is now ${newStatus.toLowerCase()}.`,
  };
}

/**
 * Deletes an unbooked slot.
 */
export async function deleteSlotAction(slotId: string) {
  const user = await requireRole(Role.DOCTOR);

  if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can manage slots." };
  }

  const slot = await db.availability.findUnique({
    where: { id: slotId },
  });

  if (!slot || slot.doctorId !== user.doctor.id) {
    return { success: false, error: "Slot not found or unauthorized." };
  }

  if (slot.status === SlotStatus.BOOKED) {
    return { success: false, error: "Booked slots cannot be deleted." };
  }

  await db.availability.delete({
    where: { id: slotId },
  });

  revalidatePath("/doctor/slots");
  revalidatePath("/doctor/dashboard");
  revalidatePath("/doctors");

  return {
    success: true,
    message: "Slot successfully deleted.",
  };
}
