"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { slotGenerationSchema, type SlotGenerationInput } from "@/lib/validations/slots";
import { getISTDateString, parseISTDateTime } from "@/lib/time";
import { Role, DoctorStatus, SlotStatus } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { releaseSlot } from "@/lib/slots";
import { scheduleSchema, type ScheduleInput } from "@/lib/validations/slots";
import { generateScheduleAvailabilities, validateScheduleInput, planScheduleDates, shouldRestoreRecurringDate, overrideRequiresConfirmation, scheduleDateRelationship } from "@/lib/scheduling";
import { getTodayISTDateString } from "@/lib/time";
import { AvailabilityKind } from "@/generated/prisma/client";
import { AppointmentStatus, RefundReason, NotificationType, PaymentStatus } from "@/generated/prisma/client";
import { requestRefund } from "@/lib/payments/service";
import { createNotification } from "@/lib/notifications";
import { enqueuePatientNotifications } from "@/lib/notifications/index";

/**
 * Generates slots in bulk according to the doctor's specifications.
 * Enforces:
 * - Approved doctor check
 * - Overlap check against existing slots
 * - Time-off check against DoctorTimeOff (sets BLOCKED with blockedByTimeOffId if within time-off)
 * - Atomic createMany insertion
 */
export async function generateSlotsAction(input: SlotGenerationInput) {
  const user = await requireRole(Role.DOCTOR);

  if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) {
    return {
      success: false,
      error: "Only approved doctors can configure consultation availability.",
    };
  }

  const parsed = slotGenerationSchema.safeParse(input);
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

  const candidateSlots: {
    doctorId: string;
    startTime: Date;
    endTime: Date;
    status: SlotStatus;
    blockedByTimeOffId?: string | null;
  }[] = [];

  for (let current = startD.getTime(); current <= endD.getTime(); current += dayMillis) {
    const curDate = new Date(current);
    const dateStr = curDate.toISOString().slice(0, 10);
    const probe = parseISTDateTime(dateStr, "12:00");
    const istOffset = 5.5 * 60 * 60 * 1000;
    const probeIST = new Date(probe.getTime() + istOffset);
    const dayOfWeek = probeIST.getUTCDay();

    if (!daysOfWeek.includes(dayOfWeek)) {
      continue;
    }

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

  const minTime = candidateSlots[0].startTime;
  const maxTime = candidateSlots[candidateSlots.length - 1].endTime;

  // Query existing slots and active doctor time-offs
  const [existingSlots, activeTimeOffs] = await Promise.all([
    db.availability.findMany({
      where: {
        doctorId,
        startTime: { gte: minTime, lte: maxTime },
      },
      select: { startTime: true, endTime: true },
    }),
    db.doctorTimeOff.findMany({
      where: {
        doctorId,
        startAt: { lt: maxTime },
        endAt: { gt: minTime },
      },
      select: { id: true, startAt: true, endAt: true },
    }),
  ]);

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
      continue;
    }

    // Check if slot falls inside an active DoctorTimeOff
    const matchingTimeOff = activeTimeOffs.find(
      (to) =>
        candidate.startTime.getTime() < to.endAt.getTime() &&
        candidate.endTime.getTime() > to.startAt.getTime()
    );

    if (matchingTimeOff) {
      // Slot generated inside an active doctor absence is created as BLOCKED
      nonOverlappingSlots.push({
        ...candidate,
        status: SlotStatus.BLOCKED,
        blockedByTimeOffId: matchingTimeOff.id,
      });
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
 * Uses shared releaseSlot helper when unblocking so active time-offs are respected.
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

  if (slot.status === SlotStatus.AVAILABLE) {
    await db.availability.update({
      where: { id: slotId },
      data: { status: SlotStatus.BLOCKED, blockedByTimeOffId: null },
    });
    revalidatePath("/doctor/slots");
    return { success: true, newStatus: SlotStatus.BLOCKED, message: "Slot is now blocked." };
  } else {
    const activeTimeOff = await db.doctorTimeOff.findFirst({
      where: {
        doctorId: slot.doctorId,
        startAt: { lt: slot.endTime },
        endAt: { gt: slot.startTime },
      },
      select: { id: true },
    });
    const res = activeTimeOff
      ? await db.availability.update({
          where: { id: slotId },
          data: { status: SlotStatus.BLOCKED, blockedByTimeOffId: activeTimeOff.id },
        }).then(() => ({ newStatus: SlotStatus.BLOCKED }))
      : await db.availability.update({
          where: { id: slotId },
          data: { status: slot.activeCount >= slot.capacity ? SlotStatus.BOOKED : SlotStatus.AVAILABLE, blockedByTimeOffId: null },
        }).then((updated) => ({ newStatus: updated.status }));
    revalidatePath("/doctor/slots");
    return {
      success: true,
      newStatus: res.newStatus,
      message: res.newStatus === SlotStatus.AVAILABLE ? "Slot is now available." : "Slot remains blocked due to active time off.",
    };
  }
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

  const appointmentHistory = await db.appointment.count({
    where: { availabilityId: slotId },
  });
  if (appointmentHistory > 0) {
    return {
      success: false,
      error: "This slot has appointment history and cannot be deleted. Block it instead.",
    };
  }

  await db.availability.delete({ where: { id: slotId } });

  revalidatePath("/doctor/slots");
  revalidatePath("/doctor/dashboard");
  revalidatePath("/doctors");

  return {
    success: true,
    message: "Slot successfully deleted.",
  };
}

export async function cancelAllSlotsForDateAction(date: string, confirmCancellation = false) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;
  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Approved doctor access is required." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { success: false, error: "Invalid slot date." };
  }

  const dayStart = parseISTDateTime(date, "00:00");
  const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const rows = await db.availability.findMany({
    where: {
      doctorId: doctor.id,
      startTime: { gte: dayStart, lt: nextDayStart },
    },
    include: {
      appointments: {
        where: { status: { in: OVERRIDE_ACTIVE_STATUSES } },
        include: {
          patient: { select: { userId: true } },
          payments: { where: { status: PaymentStatus.PAID }, take: 1 },
        },
      },
    },
  });
  if (rows.length === 0) {
    return { success: false, error: "No slots found for this date." };
  }

  const active = rows.flatMap((row) =>
    row.appointments.map((appointment) => ({
      appointmentId: appointment.id,
      availabilityId: row.id,
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
      patientUserId: appointment.patient.userId,
      paymentId: appointment.payments[0]?.id,
    })),
  );
  if (active.length > 0 && !confirmCancellation) {
    return {
      success: false,
      requiresConfirmation: true,
      activeAppointments: active.map(({ appointmentId, startTime, endTime }) => ({
        appointmentId,
        startTime,
        endTime,
      })),
    };
  }

  await db.$transaction(async (tx) => {
    for (const appointment of active) {
      await tx.appointment.update({
        where: { id: appointment.appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: "DOCTOR",
          cancellationReason: "All slots for date cancelled",
          waveId: null,
        },
      });
      await releaseSlot(tx, appointment.availabilityId);
    }
    await tx.availability.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { status: SlotStatus.BLOCKED },
    });
  }, { maxWait: 10000, timeout: 20000 });

  for (const appointment of active) {
    if (appointment.paymentId) {
      await requestRefund({
        paymentId: appointment.paymentId,
        appointmentId: appointment.appointmentId,
        reason: RefundReason.DOCTOR_ABSENCE,
        note: "All slots for this date were cancelled; refund initiated",
      });
    }
    await createNotification({
      userId: appointment.patientUserId,
      type: NotificationType.DOCTOR_ABSENCE,
      title: "Doctor unavailable",
      body: "Your consultation slot was cancelled. A refund was initiated where applicable; please rebook.",
      href: "/patient/appointments",
    });
    await enqueuePatientNotifications(db, {
      userId: appointment.patientUserId,
      appointmentId: appointment.appointmentId,
      template: "appointment_cancelled",
      payload: {
        doctorName: user.name ?? "Doctor",
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        cancelledBy: "DOCTOR",
        refundSummary: appointment.paymentId
          ? "A refund has been initiated and remains pending until provider success."
          : null,
        refundInitiated: Boolean(appointment.paymentId),
      },
      dedupeKey: `email:slots_date_cancelled:${appointment.appointmentId}`,
    });
  }

  revalidatePath("/doctor/slots");
  revalidatePath("/doctor/dashboard");
  revalidatePath("/doctors");
  revalidatePath("/patient/appointments");
  return { success: true, cancelledCount: active.length, blockedCount: rows.length };
}

export const createBulkSlotsAction = generateSlotsAction;

export async function previewScheduleAction(input: ScheduleInput) {
  const user = await requireRole(Role.DOCTOR);
  if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can configure consultation availability." };
  }
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid schedule." };
  const validationError = validateScheduleInput(parsed.data, getTodayISTDateString());
  if (validationError) return { success: false, error: validationError };
  const now = new Date();
  const rows = generateScheduleAvailabilities(parsed.data, getTodayISTDateString())
    .filter((row) => row.endTime > now);
  const candidateDates = [...new Set(rows.map((row) => row.date))];
  const schedules = await db.availabilitySchedule.findMany({
    where: { doctorId: user.doctor.id, status: "ACTIVE" },
    select: { id: true, recurrence: true, startDate: true, endDate: true, daysOfWeek: true },
  });
  const recurringScheduleIdsByDate: Record<string, string[]> = {};
  const nonRecurringScheduleIdsByDate: Record<string, string[]> = {};
  for (const date of candidateDates) {
    for (const schedule of schedules) {
      const applies = date >= schedule.startDate && date <= schedule.endDate &&
        (schedule.recurrence === "ONCE" || schedule.daysOfWeek.includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
      if (!applies) continue;
      const target = schedule.recurrence === "ONCE" ? nonRecurringScheduleIdsByDate : recurringScheduleIdsByDate;
      (target[date] ??= []).push(schedule.id);
    }
  }
  const datePlans = planScheduleDates(parsed.data, candidateDates, recurringScheduleIdsByDate, nonRecurringScheduleIdsByDate);
  const skippedDates = datePlans.filter((plan) => plan.skipForNonRecurringScheduleId).map((plan) => plan.date);
  const overridePlans = datePlans.filter((plan) => plan.overrideRecurringScheduleId);
  const overrideScheduleIds = new Set(overridePlans.map((plan) => plan.overrideRecurringScheduleId));
  const conflicts = await db.availability.findMany({
    where: {
      doctorId: user.doctor.id,
      status: { not: SlotStatus.BLOCKED },
      kind: { not: AvailabilityKind.WAVE_PARENT },
      scheduleId: { notIn: [...overrideScheduleIds].filter(Boolean) as string[] },
      OR: rows.filter((row) => row.kind !== "WAVE_PARENT").map((row) => ({
        startTime: { lt: row.endTime },
        endTime: { gt: row.startTime },
      })),
    },
    select: { startTime: true, endTime: true, scheduleId: true, schedule: { select: { recurrence: true } } },
  });
  const filteredConflicts = conflicts.filter((row) => {
    const sameRequestedDate = candidateDates.includes(getISTDateString(row.startTime));
    const overridden = overrideScheduleIds.has(row.scheduleId ?? "");
    const skipped = skippedDates.includes(getISTDateString(row.startTime));
    if (!sameRequestedDate || overridden || skipped) return false;
    return parsed.data.recurrence !== "RECURRING" || row.schedule?.recurrence !== "ONCE";
  });
  return {
    success: true,
    count: rows.filter((row) => row.kind !== "WAVE_PARENT" && !skippedDates.includes(row.date)).length,
    dates: candidateDates.filter((date) => !skippedDates.includes(date)),
    subSlots: parsed.data.type === "WAVE" ? (parsed.data.endMinute - parsed.data.startMinute) / parsed.data.durationMinutes : 0,
    conflicts: filteredConflicts.map((row) => ({ startTime: row.startTime.toISOString(), endTime: row.endTime.toISOString() })),
    overrides: overridePlans.map((plan) => ({ date: plan.date, scheduleId: plan.overrideRecurringScheduleId!, message: `This will replace the recurring availability on ${plan.date}.` })),
    skippedDates,
  };
}

const OVERRIDE_ACTIVE_STATUSES = [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.PENDING_PAYMENT,
    AppointmentStatus.IN_CONSULTATION,
  ];

export async function blockScheduleDateAction(scheduleId: string, date: string, confirmCancellation = false) {
    const user = await requireRole(Role.DOCTOR);
    const doctor = user.doctor;
    if (!doctor || doctor.status !== DoctorStatus.APPROVED) return { success: false, error: "Approved doctor access is required." };
    const schedule = await db.availabilitySchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule || schedule.doctorId !== doctor.id) return { success: false, error: "Schedule not found or unauthorized." };
    const rows = await db.availability.findMany({
      where: { scheduleId, startTime: { gte: parseISTDateTime(date, "00:00") }, endTime: { lte: parseISTDateTime(date, "23:59") } },
      include: { appointments: { where: { status: { in: OVERRIDE_ACTIVE_STATUSES } }, include: { patient: { select: { userId: true } }, payments: { where: { status: PaymentStatus.PAID }, take: 1 } } } },
    });
    const active = rows.flatMap((row) => row.appointments.map((appointment) => ({ appointmentId: appointment.id, startTime: row.startTime.toISOString(), endTime: row.endTime.toISOString(), patientUserId: appointment.patient.userId, paymentId: appointment.payments[0]?.id, availabilityId: row.id })));
    if (active.length > 0 && !confirmCancellation) return { success: false, requiresConfirmation: true, activeAppointments: active.map(({ appointmentId, startTime, endTime }) => ({ appointmentId, startTime, endTime })) };
    await db.availabilityException.upsert({ where: { scheduleId_date: { scheduleId, date } }, create: { doctorId: doctor.id, scheduleId, date, reason: "Blocked by doctor" }, update: { reason: "Blocked by doctor" } });
    for (const appointment of active) {
      await db.$transaction(async (tx) => {
        await tx.appointment.update({ where: { id: appointment.appointmentId }, data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date(), cancelledBy: "DOCTOR", cancellationReason: "Schedule date blocked", waveId: null } });
        await releaseSlot(tx, appointment.availabilityId);
      }, { maxWait: 10000, timeout: 20000 });
      if (appointment.paymentId) await requestRefund({ paymentId: appointment.paymentId, appointmentId: appointment.appointmentId, reason: RefundReason.DOCTOR_ABSENCE, note: "Schedule date blocked by doctor; refund initiated" });
      await createNotification({ userId: appointment.patientUserId, type: NotificationType.DOCTOR_ABSENCE, title: "Doctor unavailable", body: "Your consultation date was blocked by the doctor. A refund was initiated where applicable; please rebook.", href: "/patient/appointments" });
      await enqueuePatientNotifications(db, { userId: appointment.patientUserId, appointmentId: appointment.appointmentId, template: "appointment_cancelled", payload: { doctorName: user.name ?? "Doctor", startTime: appointment.startTime, endTime: appointment.endTime, cancelledBy: "DOCTOR", refundSummary: appointment.paymentId ? "A refund has been initiated and remains pending until provider success." : null, refundInitiated: Boolean(appointment.paymentId) }, dedupeKey: `email:schedule_blocked:${appointment.appointmentId}` });
    }
    await db.availability.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { status: SlotStatus.BLOCKED } });
    revalidatePath("/doctor/slots");
    revalidatePath("/patient/appointments");
    return { success: true, cancelledCount: active.length };
  }

export async function unblockScheduleDateAction(scheduleId: string, date: string) {
    const user = await requireRole(Role.DOCTOR);
    if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) return { success: false, error: "Approved doctor access is required." };
    const exception = await db.availabilityException.findUnique({ where: { scheduleId_date: { scheduleId, date } } });
    if (!exception || exception.doctorId !== user.doctor.id) return { success: false, error: "Blocked date not found." };
    const hasReplacement = await db.availability.count({ where: { doctorId: user.doctor.id, scheduleId: { not: scheduleId }, status: { not: SlotStatus.BLOCKED }, startTime: { gte: parseISTDateTime(date, "00:00") }, endTime: { lte: parseISTDateTime(date, "23:59") } } });
    if (hasReplacement > 0) return { success: false, error: "A replacement schedule already occupies this date." };
    await db.availabilityException.delete({ where: { id: exception.id } });
    await db.availability.updateMany({ where: { scheduleId, startTime: { gte: parseISTDateTime(date, "00:00") }, endTime: { lte: parseISTDateTime(date, "23:59") }, activeCount: 0 }, data: { status: SlotStatus.AVAILABLE } });
    revalidatePath("/doctor/slots");
    return { success: true };
  }

export async function cancelScheduleAction(scheduleId: string, confirmCancellation = false) {
    const user = await requireRole(Role.DOCTOR);
    if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) return { success: false, error: "Approved doctor access is required." };
    const schedule = await db.availabilitySchedule.findUnique({ where: { id: scheduleId }, include: { availabilities: { include: { appointments: { where: { status: { in: OVERRIDE_ACTIVE_STATUSES } }, include: { patient: { select: { userId: true } }, payments: { where: { status: PaymentStatus.PAID }, take: 1 } } } } } } });
    if (!schedule || schedule.doctorId !== user.doctor.id) return { success: false, error: "Schedule not found or unauthorized." };
    const active = schedule.availabilities.flatMap((row) => row.appointments.map((appointment) => ({ appointmentId: appointment.id, availabilityId: row.id, startTime: row.startTime.toISOString(), endTime: row.endTime.toISOString(), patientUserId: appointment.patient.userId, paymentId: appointment.payments[0]?.id })));
    if (active.length > 0 && !confirmCancellation) return { success: false, requiresConfirmation: true, activeAppointments: active };
    for (const appointment of active) {
      await db.$transaction(async (tx) => {
        await tx.appointment.update({ where: { id: appointment.appointmentId }, data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date(), cancelledBy: "DOCTOR", cancellationReason: "Schedule cancelled" } });
        await releaseSlot(tx, appointment.availabilityId);
      }, { maxWait: 10000, timeout: 20000 });
      if (appointment.paymentId) await requestRefund({ paymentId: appointment.paymentId, appointmentId: appointment.appointmentId, reason: RefundReason.DOCTOR_ABSENCE, note: "Schedule cancelled by doctor; refund initiated" });
      await createNotification({ userId: appointment.patientUserId, type: NotificationType.DOCTOR_ABSENCE, title: "Doctor unavailable", body: "Your consultation schedule was cancelled. A refund was initiated where applicable; please rebook.", href: "/patient/appointments" });
    }
    if (schedule.recurrence === "ONCE") {
      const overrideExceptions = await db.availabilityException.findMany({
        where: { doctorId: user.doctor.id, date: schedule.startDate, reason: "Overridden by non-recurring schedule" },
        include: { schedule: { select: { id: true, recurrence: true } } },
      });
      for (const exception of overrideExceptions) {
        if (exception.schedule?.recurrence !== "RECURRING") continue;
        const recurringRows = await db.availability.findMany({
          where: { scheduleId: exception.schedule.id, startTime: { gte: parseISTDateTime(schedule.startDate, "00:00") }, endTime: { lte: parseISTDateTime(schedule.startDate, "23:59") } },
          select: { id: true, startTime: true, endTime: true, activeCount: true },
        });
        const occupiedByOtherSchedule = recurringRows.length === 0 ? 0 : await db.availability.count({
          where: {
            doctorId: user.doctor.id,
            scheduleId: { notIn: [scheduleId, exception.schedule.id] },
            status: { not: SlotStatus.BLOCKED },
            OR: recurringRows.map((row) => ({ startTime: { lt: row.endTime }, endTime: { gt: row.startTime } })),
          },
        });
        if (shouldRestoreRecurringDate(occupiedByOtherSchedule, recurringRows.filter((row) => row.activeCount > 0).length)) {
          await db.availabilityException.delete({ where: { id: exception.id } });
          await db.availability.updateMany({ where: { id: { in: recurringRows.filter((row) => row.activeCount === 0).map((row) => row.id) } }, data: { status: SlotStatus.AVAILABLE } });
        }
      }
    }
    await db.availabilitySchedule.update({ where: { id: scheduleId }, data: { status: "CANCELLED" } });
    await db.availability.updateMany({
      where: {
        scheduleId,
        activeCount: 0,
        startTime: { gt: new Date() },
        appointments: { some: {} },
      },
      data: { status: SlotStatus.BLOCKED },
    });
    await db.availability.deleteMany({
      where: {
        scheduleId,
        activeCount: 0,
        startTime: { gt: new Date() },
        appointments: { none: {} },
      },
    });
    revalidatePath("/doctor/slots");
    return { success: true, cancelledCount: active.length };
  }


export async function createScheduleAction(input: ScheduleInput, confirmOverrideCancellation = false) {
  const user = await requireRole(Role.DOCTOR);
  if (!user.doctor || user.doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can configure consultation availability." };
  }

  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid schedule." };
  const validationError = validateScheduleInput(parsed.data, getTodayISTDateString());
  if (validationError) return { success: false, error: validationError };
  const rows = generateScheduleAvailabilities(parsed.data, getTodayISTDateString())
    .filter((row) => row.endTime > new Date());

  try {
    const candidateDates = [...new Set(rows.map((row) => row.date))];
    const existingSchedules = await db.availabilitySchedule.findMany({
      where: { doctorId: user.doctor.id, status: "ACTIVE" },
      select: { id: true, recurrence: true, startDate: true, endDate: true, daysOfWeek: true },
    });
    const recurringScheduleIdsByDate: Record<string, string[]> = {};
    const nonRecurringScheduleIdsByDate: Record<string, string[]> = {};
    for (const date of candidateDates) {
      for (const schedule of existingSchedules) {
        const applies = date >= schedule.startDate && date <= schedule.endDate &&
          (schedule.recurrence === "ONCE" || schedule.daysOfWeek.includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
        if (!applies) continue;
        const target = schedule.recurrence === "ONCE" ? nonRecurringScheduleIdsByDate : recurringScheduleIdsByDate;
        (target[date] ??= []).push(schedule.id);
      }
    }
    const datePlans = planScheduleDates(parsed.data, candidateDates, recurringScheduleIdsByDate, nonRecurringScheduleIdsByDate);
    const skippedDates = new Set(datePlans.filter((plan) => plan.skipForNonRecurringScheduleId).map((plan) => plan.date));
    const overridePlans = datePlans.filter((plan) => plan.overrideRecurringScheduleId);
    const overrideScheduleIds = overridePlans.map((plan) => plan.overrideRecurringScheduleId!);
    const existingRows = await db.availability.findMany({
      where: {
        doctorId: user.doctor.id,
        status: { not: SlotStatus.BLOCKED },
        kind: { not: AvailabilityKind.WAVE_PARENT },
        OR: rows.filter((row) => row.kind !== "WAVE_PARENT" && !skippedDates.has(row.date)).map((row) => ({
          startTime: { lt: row.endTime },
          endTime: { gt: row.startTime },
        })),
      },
      select: { startTime: true, endTime: true, scheduleId: true, schedule: { select: { recurrence: true } } },
    });
    const hasConflict = rows.some((row) => {
      if (row.kind === "WAVE_PARENT" || skippedDates.has(row.date)) return false;
      return existingRows.some((existing) => {
        if (row.date !== getISTDateString(existing.startTime)) return false;
        if (!(row.startTime < existing.endTime && row.endTime > existing.startTime)) return false;
        const relationship = scheduleDateRelationship(
          parsed.data.recurrence,
          existing.schedule?.recurrence ?? "RECURRING",
          row.date === getISTDateString(existing.startTime),
        );
        return !(relationship === "OVERRIDE" && overrideScheduleIds.includes(existing.scheduleId ?? ""));
      });
    });
    if (hasConflict) {
      return { success: false, error: "The schedule overlaps an existing non-overridden availability." };
    }
    const overrideRows = overrideScheduleIds.length === 0
      ? []
      : await db.availability.findMany({
          where: {
            scheduleId: { in: overrideScheduleIds },
            startTime: { gte: parseISTDateTime(candidateDates[0]!, "00:00") },
          },
          include: {
            appointments: {
              where: { status: { in: OVERRIDE_ACTIVE_STATUSES } },
              select: {
                id: true,
                availabilityId: true,
                status: true,
                patient: { select: { userId: true } },
                payments: {
                  where: { status: PaymentStatus.PAID },
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        });
    const activeOverrideAppointments = overrideRows
      .filter((row) => overridePlans.some((plan) => plan.overrideRecurringScheduleId === row.scheduleId && getISTDateString(row.startTime) === plan.date))
      .flatMap((row) => row.appointments.map((appointment) => ({ ...appointment, startTime: row.startTime, endTime: row.endTime })));
    if (overrideRequiresConfirmation(activeOverrideAppointments.length, confirmOverrideCancellation)) {
      return {
        success: false,
        requiresConfirmation: true,
        activeAppointments: activeOverrideAppointments.map((appointment) => ({
          appointmentId: appointment.id,
          startTime: appointment.startTime.toISOString(),
          endTime: appointment.endTime.toISOString(),
        })),
      };
    }
    const rowsToCreate = rows.filter((row) => !skippedDates.has(row.date));
    const result = await db.$transaction(async (tx) => {
      const schedule = await tx.availabilitySchedule.create({
        data: {
          doctorId: user.doctor!.id,
          type: parsed.data.type,
          recurrence: parsed.data.recurrence,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          daysOfWeek: parsed.data.daysOfWeek,
          startMinute: parsed.data.startMinute,
          endMinute: parsed.data.endMinute,
          durationMinutes: parsed.data.durationMinutes,
          capacity: parsed.data.capacity,
        },
      });
      for (const plan of overridePlans) {
        await tx.availabilityException.upsert({
          where: { scheduleId_date: { scheduleId: plan.overrideRecurringScheduleId!, date: plan.date } },
          create: { doctorId: user.doctor!.id, scheduleId: plan.overrideRecurringScheduleId!, date: plan.date, reason: "Overridden by non-recurring schedule" },
          update: { reason: "Overridden by non-recurring schedule" },
        });
        const recurringRows = overrideRows.filter((row) => row.scheduleId === plan.overrideRecurringScheduleId && getISTDateString(row.startTime) === plan.date);
        for (const row of recurringRows) {
          if (row.appointments.length > 0) {
            for (const appointment of row.appointments) {
              await tx.appointment.update({ where: { id: appointment.id }, data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date(), cancelledBy: "DOCTOR", cancellationReason: "Recurring availability overridden" } });
              await releaseSlot(tx, row.id);
            }
          }
        }
        await tx.availability.deleteMany({
          where: {
            id: { in: recurringRows.map((row) => row.id) },
            appointments: { none: {} },
          },
        });
      }
      const parents = new Map<number, string>();
      for (const row of rowsToCreate) {
        const created = await tx.availability.create({
          data: {
            doctorId: user.doctor!.id,
            startTime: row.startTime,
            endTime: row.endTime,
            kind: row.kind,
            capacity: row.capacity,
            scheduleId: schedule.id,
            parentId: row.parentIndex === undefined ? undefined : parents.get(row.parentIndex),
          },
        });
        const rowIndex = rows.indexOf(row);
        if (row.kind === "WAVE_PARENT") parents.set(rowIndex, created.id);
      }
      return { schedule, overrideAppointments: activeOverrideAppointments };
    }, { maxWait: 10000, timeout: 20000 });
    for (const appointment of result.overrideAppointments) {
      if (appointment.payments[0]?.id) await requestRefund({ paymentId: appointment.payments[0].id, appointmentId: appointment.id, reason: RefundReason.DOCTOR_ABSENCE, note: "Recurring availability overridden; refund initiated" });
      await createNotification({ userId: appointment.patient.userId, type: NotificationType.DOCTOR_ABSENCE, title: "Doctor availability changed", body: "Your recurring consultation availability was replaced for this date. A refund was initiated where applicable; please rebook.", href: "/patient/appointments" });
      await enqueuePatientNotifications(db, { userId: appointment.patient.userId, appointmentId: appointment.id, template: "appointment_cancelled", payload: { doctorName: user.name ?? "Doctor", startTime: appointment.startTime.toISOString(), endTime: appointment.endTime.toISOString(), cancelledBy: "DOCTOR", refundSummary: appointment.payments[0]?.id ? "A refund has been initiated and remains pending until provider success." : null, refundInitiated: Boolean(appointment.payments[0]?.id) }, dedupeKey: `email:schedule_override:${appointment.id}` });
    }
    revalidatePath("/doctor/slots");
    revalidatePath("/doctors");
    return { success: true, scheduleId: result.schedule.id, createdCount: rows.filter((row) => !skippedDates.has(row.date)).length };
  } catch (error) {
    console.error("[createScheduleAction] Failed to create schedule:", error);
    return { success: false, error: "The schedule conflicts with existing availability or could not be created." };
  }
}
