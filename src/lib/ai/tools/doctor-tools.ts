import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  AppointmentStatus,
  AvailabilityKind,
  DoctorStatus,
  Role,
  ScheduleStatus,
  SlotStatus,
} from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { canDoctorNoShow, isValidTransition } from "@/lib/appointment-status";
import { previewScheduleAction } from "@/lib/actions/slots";
import { discoverAlternativeAppointmentsForPatient } from "@/lib/actions/reschedule";
import { calculateElasticRange, diffAvailabilityIntervals, effectiveSlot } from "@/lib/scheduling";
import {
  formatDateIST,
  formatTimeIST,
  getISTDateString,
  getISTDayRangeUTC,
  getTodayISTDateString,
  parseISTDateTime,
} from "@/lib/time";
import { createPendingConfirmation } from "@/lib/ai/confirmation";
import {
  buildDoctorStatsCard,
  computeDoctorAppointmentStats,
  detectDoctorSchedulingConflicts,
  formatRupeesFromDecimal,
  formatSlotTimeRangeIST,
  getISTHHmm,
  hhmmToMinutes,
  minutesToHHmm,
  resolveISTDateInput,
} from "@/lib/ai/helpers";
import type {
  AppointmentCardData,
  AssistantCard,
  SlotOptionData,
} from "@/lib/ai/schemas";

export interface DoctorToolContext {
  userId: string;
  doctorId: string;
  doctorName: string;
  specialization: string;
  consultationFeeRupees: number;
  doctorStatus: DoctorStatus;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function createDoctorTools(ctx: DoctorToolContext) {
  return {
    getDoctorAppointments: tool({
      description:
        "Retrieve the doctor's appointments for today, tomorrow, a specific IST date, upcoming schedule, or only the next upcoming patient.",
      inputSchema: z.object({
        date: z
          .string()
          .optional()
          .describe("Optional IST date ('today', 'tomorrow', or YYYY-MM-DD)."),
        status: z
          .enum([
            "ALL",
            "CONFIRMED",
            "CHECKED_IN",
            "IN_CONSULTATION",
            "COMPLETED",
            "CANCELLED",
            "NO_SHOW",
            "PENDING_PAYMENT",
            "DISRUPTED",
          ])
          .default("ALL"),
        nextOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: async ({ date, status, nextOnly, limit }) => {
        const now = new Date();
        const resolvedDate = resolveISTDateInput(date);
        const dayRange = resolvedDate ? getISTDayRangeUTC(resolvedDate) : null;

        const appointments = await db.appointment.findMany({
          where: {
            availability: {
              doctorId: ctx.doctorId,
              ...(dayRange
                ? {
                    startTime: {
                      gte: dayRange.start,
                      lt: dayRange.nextDayStart,
                    },
                  }
                : nextOnly
                  ? {
                      endTime: { gte: now },
                    }
                  : {}),
            },
          },
          include: {
            patient: {
              select: {
                user: { select: { name: true } },
              },
            },
            availability: {
              select: {
                id: true,
                startTime: true,
                endTime: true,
                kind: true,
              },
            },
            wave: {
              select: {
                notes: true,
                windowStart: true,
                windowEnd: true,
              },
            },
            payments: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                status: true,
                amount: true,
              },
            },
          },
          orderBy: {
            availability: {
              startTime: "asc",
            },
          },
          take: 80,
        });

        const filtered = appointments.filter((appt) => {
          if (status === "DISRUPTED") {
            return (
              appt.disruptedAt !== null &&
              appt.rescheduleStatus === "PENDING_RESCHEDULING"
            );
          }
          if (status !== "ALL" && appt.status !== status) {
            return false;
          }
          if (nextOnly) {
            const w = effectiveSlot(appt);
            const active =
              appt.status === AppointmentStatus.CONFIRMED ||
              appt.status === AppointmentStatus.CHECKED_IN ||
              appt.status === AppointmentStatus.IN_CONSULTATION;
            return active && w.end >= now;
          }
          return true;
        });

        const selected = filtered.slice(0, nextOnly ? 1 : limit);
        const items: AppointmentCardData[] = selected.map((appt) => {
          const window = effectiveSlot(appt);
          const latestPayment = appt.payments[0] ?? null;
          const noShowCheck = canDoctorNoShow({
            status: appt.status,
            startTime: window.start,
          });

          return {
            id: appt.id,
            status: appt.status,
            rescheduleStatus: appt.rescheduleStatus,
            disruptedAt: appt.disruptedAt ? appt.disruptedAt.toISOString() : null,
            disruptionReason: appt.disruptionReason,
            doctorId: ctx.doctorId,
            doctorName: ctx.doctorName,
            doctorSpecialization: ctx.specialization,
            patientName: appt.patient.user.name || "Patient",
            dateIST: formatDateIST(window.start),
            timeRangeIST: formatSlotTimeRangeIST(window.start, window.end),
            slotKind: appt.availability.kind,
            waveLabel: appt.wave
              ? appt.wave.notes ||
                formatSlotTimeRangeIST(appt.wave.windowStart, appt.wave.windowEnd)
              : null,
            paymentStatus: latestPayment?.status ?? null,
            amountDisplay: latestPayment
              ? formatRupeesFromDecimal(latestPayment.amount)
              : formatRupeesFromDecimal(ctx.consultationFeeRupees),
            canDoctorCancel: isValidTransition(
              appt.status,
              AppointmentStatus.CANCELLED,
              Role.DOCTOR
            ),
            canDoctorComplete: isValidTransition(
              appt.status,
              AppointmentStatus.COMPLETED,
              Role.DOCTOR
            ),
            canDoctorNoShow: noShowCheck.allowed,
            availabilityId: appt.availability.id,
            notes: appt.reason,
          };
        });

        const title = nextOnly
          ? "Next Scheduled Patient"
          : resolvedDate
            ? `Appointments for ${formatDateIST(parseISTDateTime(resolvedDate, "00:00"))}`
            : "Scheduled Appointments";

        const card: AssistantCard = {
          type: "appointment_list",
          title,
          viewerRole: "DOCTOR",
          items,
        };

        return {
          ok: true,
          count: items.length,
          appointments: items,
          card,
        };
      },
    }),

    getDoctorAppointmentStats: tool({
      description:
        "Compute real patient booking and consultation status statistics for today, tomorrow, a specific date, or upcoming/all-time.",
      inputSchema: z.object({
        date: z
          .string()
          .optional()
          .describe("Optional IST date ('today', 'tomorrow', or YYYY-MM-DD)."),
        scope: z.enum(["date", "upcoming", "all"]).default("date"),
      }),
      execute: async ({ date, scope }) => {
        const now = new Date();
        const resolvedDate =
          scope === "date"
            ? resolveISTDateInput(date ?? "today") ?? getTodayISTDateString()
            : resolveISTDateInput(date);
        const dayRange = resolvedDate ? getISTDayRangeUTC(resolvedDate) : null;

        const rows = await db.appointment.findMany({
          where: {
            availability: {
              doctorId: ctx.doctorId,
              ...(dayRange
                ? {
                    startTime: {
                      gte: dayRange.start,
                      lt: dayRange.nextDayStart,
                    },
                  }
                : scope === "upcoming"
                  ? {
                      startTime: {
                        gte: getISTDayRangeUTC(getTodayISTDateString()).start,
                      },
                    }
                  : {}),
            },
          },
          select: {
            status: true,
            disruptedAt: true,
            rescheduleStatus: true,
          },
        });

        const stats = computeDoctorAppointmentStats(rows);
        const label = dayRange
          ? formatDateIST(parseISTDateTime(resolvedDate!, "00:00"))
          : scope === "upcoming"
            ? "From Today Onward"
            : `As of ${formatDateIST(now)}`;

        const card = buildDoctorStatsCard("Practice Booking Stats", label, stats);

        return {
          ok: true,
          dateRangeLabel: label,
          stats,
          card,
        };
      },
    }),

    getDoctorAvailability: tool({
      description:
        "Inspect the doctor's generated availability slots for a date or from today onward, showing remaining capacity and blocked state.",
      inputSchema: z.object({
        date: z
          .string()
          .optional()
          .describe("Optional IST date ('today', 'tomorrow', or YYYY-MM-DD)."),
        includeBlocked: z.boolean().default(true),
        limit: z.number().int().min(1).max(40).default(20),
      }),
      execute: async ({ date, includeBlocked, limit }) => {
        const now = new Date();
        const resolvedDate = resolveISTDateInput(date);
        const dayRange = resolvedDate ? getISTDayRangeUTC(resolvedDate) : null;

        const slots = await db.availability.findMany({
          where: {
            doctorId: ctx.doctorId,
            kind: {
              in: [
                AvailabilityKind.SINGLE,
                AvailabilityKind.WAVE_SLOT,
                AvailabilityKind.STREAM_WINDOW,
              ],
            },
            ...(includeBlocked ? {} : { status: { not: SlotStatus.BLOCKED } }),
            ...(dayRange
              ? {
                  startTime: {
                    gte: dayRange.start,
                    lt: dayRange.nextDayStart,
                  },
                }
              : {
                  endTime: { gte: now },
                }),
          },
          orderBy: { startTime: "asc" },
          take: limit,
        });

        const formatted = slots.map((s) => ({
          availabilityId: s.id,
          doctorId: ctx.doctorId,
          doctorName: ctx.doctorName,
          doctorSpecialization: ctx.specialization,
          dateIST: formatDateIST(s.startTime),
          timeRangeIST: formatSlotTimeRangeIST(s.startTime, s.endTime),
          kind: s.kind,
          capacity: s.capacity,
          activeCount: s.activeCount,
          remainingSeats:
            s.status === SlotStatus.BLOCKED ? 0 : Math.max(0, s.capacity - s.activeCount),
          consultationFeeRupees: ctx.consultationFeeRupees,
          status: s.status,
          scheduleId: s.scheduleId,
        }));

        return {
          ok: true,
          count: formatted.length,
          slots: formatted,
        };
      },
    }),

    getDoctorWorkingHours: tool({
      description:
        "Retrieve the doctor's active working-hour schedules (Wave/Stream, Recurring/Non-recurring rules, hours, duration, capacity, and exceptions).",
      inputSchema: z.object({}),
      execute: async () => {
        const schedules = await db.availabilitySchedule.findMany({
          where: {
            doctorId: ctx.doctorId,
            status: ScheduleStatus.ACTIVE,
          },
          include: {
            exceptions: {
              orderBy: { date: "asc" },
              take: 15,
            },
          },
          orderBy: { createdAt: "desc" },
        });

        return {
          ok: true,
          count: schedules.length,
          schedules: schedules.map((s) => ({
            id: s.id,
            type: s.type,
            recurrence: s.recurrence,
            days: s.daysOfWeek.map((d) => WEEKDAY_NAMES[d] ?? String(d)),
            startTime: minutesToHHmm(s.startMinute),
            endTime: minutesToHHmm(s.endMinute),
            durationMinutes: s.durationMinutes,
            capacity: s.capacity,
            startDate: s.startDate,
            endDate: s.endDate,
            exceptions: s.exceptions.map((e) => ({
              date: e.date,
              reason: e.reason,
            })),
          })),
        };
      },
    }),

    getDoctorLeaves: tool({
      description: "Retrieve the doctor's upcoming or recent scheduled time-off / leave records.",
      inputSchema: z.object({}),
      execute: async () => {
        const now = new Date();
        const leaves = await db.doctorTimeOff.findMany({
          where: {
            doctorId: ctx.doctorId,
            endAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
          orderBy: { startAt: "asc" },
          take: 20,
        });

        return {
          ok: true,
          count: leaves.length,
          leaves: leaves.map((l) => ({
            id: l.id,
            dateIST: formatDateIST(l.startAt),
            timeRangeIST: formatSlotTimeRangeIST(l.startAt, l.endAt),
            startAt: l.startAt.toISOString(),
            endAt: l.endAt.toISOString(),
            reason: l.reason,
          })),
        };
      },
    }),

    detectSchedulingConflicts: tool({
      description:
        "Inspect the doctor's active upcoming appointments, time offs, blocked slots, and capacities to detect real scheduling conflicts.",
      inputSchema: z.object({}),
      execute: async () => {
        const now = new Date();
        const [appointments, timeOffs] = await Promise.all([
          db.appointment.findMany({
            where: {
              availability: {
                doctorId: ctx.doctorId,
                endTime: { gte: now },
              },
              status: {
                in: [
                  AppointmentStatus.CONFIRMED,
                  AppointmentStatus.CHECKED_IN,
                  AppointmentStatus.IN_CONSULTATION,
                  AppointmentStatus.PENDING_PAYMENT,
                ],
              },
            },
            include: {
              patient: { select: { user: { select: { name: true } } } },
              availability: {
                select: {
                  id: true,
                  startTime: true,
                  endTime: true,
                  status: true,
                  kind: true,
                  capacity: true,
                  activeCount: true,
                },
              },
            },
            orderBy: { availability: { startTime: "asc" } },
          }),
          db.doctorTimeOff.findMany({
            where: {
              doctorId: ctx.doctorId,
              endAt: { gte: now },
            },
            orderBy: { startAt: "asc" },
          }),
        ]);

        const conflicts = detectDoctorSchedulingConflicts({
          appointments: appointments.map((a) => ({
            id: a.id,
            patientName: a.patient.user.name || "Patient",
            status: a.status,
            slotStart: a.slotStart,
            slotEnd: a.slotEnd,
            disruptedAt: a.disruptedAt,
            rescheduleStatus: a.rescheduleStatus,
            availability: a.availability,
          })),
          timeOffs,
        });

        const card: AssistantCard = {
          type: "conflict_list",
          title: "Scheduling Conflict Scan",
          hasConflicts: conflicts.length > 0,
          items: conflicts,
        };

        return {
          ok: true,
          hasConflicts: conflicts.length > 0,
          conflictCount: conflicts.length,
          conflicts,
          card,
        };
      },
    }),

    findNextAvailableSlot: tool({
      description:
        "Find the doctor's next available open consultation slots starting from now (optionally starting on or after a specific IST date).",
      inputSchema: z.object({
        fromDate: z
          .string()
          .optional()
          .describe("Optional starting IST date ('today', 'tomorrow', or YYYY-MM-DD)."),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ fromDate, limit }) => {
        const now = new Date();
        const resolved = resolveISTDateInput(fromDate);
        const startCutoff = resolved
          ? new Date(Math.max(now.getTime(), getISTDayRangeUTC(resolved).start.getTime()))
          : now;

        const open = await db.availability.findMany({
          where: {
            doctorId: ctx.doctorId,
            status: SlotStatus.AVAILABLE,
            kind: {
              in: [
                AvailabilityKind.SINGLE,
                AvailabilityKind.WAVE_SLOT,
                AvailabilityKind.STREAM_WINDOW,
              ],
            },
            startTime: { gte: startCutoff },
          },
          orderBy: { startTime: "asc" },
          take: limit * 3,
        });

        const slots: SlotOptionData[] = open
          .filter((s) => s.activeCount < s.capacity)
          .slice(0, limit)
          .map((s) => ({
            availabilityId: s.id,
            doctorId: ctx.doctorId,
            doctorName: ctx.doctorName,
            doctorSpecialization: ctx.specialization,
            dateIST: formatDateIST(s.startTime),
            timeRangeIST: formatSlotTimeRangeIST(s.startTime, s.endTime),
            kind: s.kind,
            capacity: s.capacity,
            activeCount: s.activeCount,
            remainingSeats: Math.max(0, s.capacity - s.activeCount),
            consultationFeeRupees: ctx.consultationFeeRupees,
          }));

        const card: AssistantCard = {
          type: "slot_selector",
          title: "Your Next Available Slots",
          mode: "BOOK",
          doctorId: ctx.doctorId,
          doctorName: ctx.doctorName,
          slots,
        };

        return {
          ok: true,
          count: slots.length,
          slots,
          card,
        };
      },
    }),

    suggestRescheduleSlotsForAppointment: tool({
      description:
        "Suggest alternative slots for an affected patient appointment belonging to this doctor.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
      }),
      execute: async ({ appointmentId }) => {
        const appt = await db.appointment.findFirst({
          where: {
            id: appointmentId,
            availability: { doctorId: ctx.doctorId },
          },
          select: { id: true },
        });
        if (!appt) {
          return { ok: false, error: "Appointment not found for your doctor profile." };
        }

        const result = await discoverAlternativeAppointmentsForPatient(appt.id);
        const sameDoctor = [
          ...result.sameDayAlternatives.map((s) => ({
            ...s,
            categoryLabel: "Same-day Alternative",
          })),
          ...result.upcomingDateAlternatives.map((s) => ({
            ...s,
            categoryLabel: "Upcoming Alternative",
          })),
        ];

        const slots: SlotOptionData[] = sameDoctor.map((s) => ({
          availabilityId: s.id,
          doctorId: s.doctorId,
          doctorName: s.doctorName,
          doctorSpecialization: s.specialization,
          dateIST: formatDateIST(new Date(s.startTime)),
          timeRangeIST: formatSlotTimeRangeIST(
            new Date(s.startTime),
            new Date(s.endTime)
          ),
          kind: s.kind,
          capacity: s.capacity,
          activeCount: s.activeCount,
          remainingSeats: Math.max(0, s.capacity - s.activeCount),
          consultationFeeRupees: ctx.consultationFeeRupees,
          categoryLabel: s.categoryLabel,
        }));

        const card: AssistantCard = {
          type: "slot_selector",
          title: "Alternative Slots for Patient",
          mode: "DOCTOR_RESCHEDULE",
          doctorId: ctx.doctorId,
          doctorName: ctx.doctorName,
          appointmentId: appt.id,
          slots,
        };

        return {
          ok: true,
          sameDoctorCount: slots.length,
          otherDoctorCount: result.otherDoctorAlternatives.length,
          slots,
          card,
        };
      },
    }),

    prepareScheduleShrinkOrExpand: tool({
      description:
        "Preview impact on booked appointments and stage a signed confirmation card to shrink or expand an active Wave or Stream AvailabilitySchedule using Elastic Scheduling.",
      inputSchema: z.object({
        mode: z.enum(["SHRINK", "EXPAND"]),
        scheduleId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Active AvailabilitySchedule ID. Omit when only one active Wave or Stream schedule applies on the target date."
          ),
        availabilityId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Optional Availability window/slot ID to resolve its parent schedule."
          ),
        date: z
          .string()
          .optional()
          .describe(
            "IST date ('today', 'tomorrow', or YYYY-MM-DD). Defaults to today."
          ),
        edge: z.enum(["START", "END"]).default("END"),
        steps: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of interval blocks to shrink or expand."),
        minutesToAdjust: z
          .number()
          .int()
          .min(5)
          .max(1440)
          .optional()
          .describe(
            "Total minutes to shrink or expand if steps is omitted (must divide evenly by schedule block duration)."
          ),
        applyToFuture: z.boolean().default(false),
      }),
      execute: async ({
        mode,
        scheduleId,
        availabilityId,
        date,
        edge,
        steps,
        minutesToAdjust,
        applyToFuture,
      }) => {
        if (ctx.doctorStatus !== DoctorStatus.APPROVED) {
          return {
            ok: false,
            error: "Doctor profile must be APPROVED to modify schedules.",
          };
        }

        const resolvedDate = resolveISTDateInput(date?.trim() || "today");
        if (!resolvedDate) {
          return {
            ok: false,
            error: "Please specify a valid date (YYYY-MM-DD, today, or tomorrow).",
          };
        }

        const todayIST = getTodayISTDateString();
        if (resolvedDate < todayIST) {
          return {
            ok: false,
            error: `Cannot ${mode.toLowerCase()} availability on ${resolvedDate} because it is in the past.`,
          };
        }

        const dayRange = getISTDayRangeUTC(resolvedDate);
        const scheduleSelect = {
          id: true,
          type: true,
          recurrence: true,
          startMinute: true,
          endMinute: true,
          durationMinutes: true,
        } as const;

        let schedule: {
          id: string;
          type: "WAVE" | "STREAM";
          recurrence: "ONCE" | "RECURRING";
          startMinute: number;
          endMinute: number;
          durationMinutes: number;
        } | null = null;

        let resolvedScheduleId = scheduleId;
        if (!resolvedScheduleId && availabilityId) {
          const avail = await db.availability.findFirst({
            where: {
              id: availabilityId,
              doctorId: ctx.doctorId,
            },
            select: {
              id: true,
              kind: true,
              scheduleId: true,
            },
          });
          if (!avail) {
            return {
              ok: false,
              error: "That availability slot or window was not found for your account.",
            };
          }
          if (!avail.scheduleId) {
            return {
              ok: false,
              error:
                "Standalone single slots cannot be shrunk or expanded elastically. You can block or unblock the slot, or adjust a Wave/Stream schedule.",
            };
          }
          resolvedScheduleId = avail.scheduleId;
        }

        if (resolvedScheduleId) {
          schedule = await db.availabilitySchedule.findFirst({
            where: {
              id: resolvedScheduleId,
              doctorId: ctx.doctorId,
              status: ScheduleStatus.ACTIVE,
            },
            select: scheduleSelect,
          });

          if (!schedule) {
            const availFallback = await db.availability.findFirst({
              where: {
                id: resolvedScheduleId,
                doctorId: ctx.doctorId,
              },
              select: {
                id: true,
                kind: true,
                scheduleId: true,
              },
            });
            if (availFallback && !availFallback.scheduleId) {
              return {
                ok: false,
                error:
                  "Standalone single slots cannot be shrunk or expanded elastically. You can block or unblock the slot, or adjust a Wave/Stream schedule.",
              };
            }
            if (availFallback?.scheduleId) {
              schedule = await db.availabilitySchedule.findFirst({
                where: {
                  id: availFallback.scheduleId,
                  doctorId: ctx.doctorId,
                  status: ScheduleStatus.ACTIVE,
                },
                select: scheduleSelect,
              });
            }
          }

          if (!schedule) {
            return {
              ok: false,
              error: "Active Wave or Stream schedule not found for your account.",
            };
          }
        } else {
          const dayWindows = await db.availability.findMany({
            where: {
              doctorId: ctx.doctorId,
              scheduleId: { not: null },
              kind: {
                in: [
                  AvailabilityKind.WAVE_PARENT,
                  AvailabilityKind.STREAM_WINDOW,
                ],
              },
              startTime: {
                gte: dayRange.start,
                lt: dayRange.nextDayStart,
              },
            },
            select: {
              scheduleId: true,
            },
          });

          const candidateIds = Array.from(
            new Set(
              dayWindows
                .map((w) => w.scheduleId)
                .filter((id): id is string => Boolean(id))
            )
          );

          const matchingSchedules =
            candidateIds.length > 0
              ? await db.availabilitySchedule.findMany({
                  where: {
                    id: { in: candidateIds },
                    doctorId: ctx.doctorId,
                    status: ScheduleStatus.ACTIVE,
                  },
                  orderBy: { createdAt: "asc" },
                  select: scheduleSelect,
                })
              : [];

          if (matchingSchedules.length === 0) {
            const singleCount = await db.availability.count({
              where: {
                doctorId: ctx.doctorId,
                kind: AvailabilityKind.SINGLE,
                startTime: {
                  gte: dayRange.start,
                  lt: dayRange.nextDayStart,
                },
              },
            });
            if (singleCount > 0) {
              return {
                ok: false,
                error: `On ${resolvedDate}, you only have standalone single slots (not a Wave or Stream schedule), so elastic shrink/expand does not apply.`,
              };
            }
            return {
              ok: false,
              error: `No active Wave or Stream availability window was found on ${resolvedDate}.`,
            };
          }

          if (matchingSchedules.length > 1) {
            return {
              ok: false,
              error: `Multiple active schedules exist on ${resolvedDate}. Ask the doctor which one to ${mode.toLowerCase()}.`,
              candidates: matchingSchedules.map((s) => ({
                scheduleId: s.id,
                type: s.type,
                recurrence: s.recurrence,
                timeRangeIST: `${minutesToHHmm(s.startMinute)}–${minutesToHHmm(s.endMinute)} IST`,
                durationMinutes: s.durationMinutes,
              })),
            };
          }

          schedule = matchingSchedules[0];
        }

        let resolvedSteps = steps ?? 1;
        if (steps === undefined && minutesToAdjust !== undefined) {
          if (minutesToAdjust % schedule.durationMinutes !== 0) {
            return {
              ok: false,
              error: `This ${schedule.type} schedule uses ${schedule.durationMinutes}-minute blocks, so ${minutesToAdjust} minutes cannot be adjusted cleanly. Choose a multiple of ${schedule.durationMinutes} minutes.`,
            };
          }
          const calculated = minutesToAdjust / schedule.durationMinutes;
          if (calculated < 1 || calculated > 100) {
            return {
              ok: false,
              error: `Adjustment step count (${calculated}) must be between 1 and 100 blocks.`,
            };
          }
          resolvedSteps = calculated;
        }

        const dateException = await db.availabilityException.findFirst({
          where: {
            doctorId: ctx.doctorId,
            date: resolvedDate,
            OR: [{ scheduleId: null }, { scheduleId: schedule.id }],
          },
          select: {
            id: true,
            reason: true,
          },
        });
        if (dateException) {
          return {
            ok: false,
            error: `${resolvedDate} has an active schedule override or blocked exception${
              dateException.reason ? ` (${dateException.reason})` : ""
            } and cannot be adjusted elastically.`,
          };
        }

        const dayParents = await db.availability.findMany({
          where: {
            doctorId: ctx.doctorId,
            scheduleId: schedule.id,
            kind: {
              in: [AvailabilityKind.WAVE_PARENT, AvailabilityKind.STREAM_WINDOW],
            },
            startTime: {
              gte: dayRange.start,
              lt: dayRange.nextDayStart,
            },
          },
          orderBy: { startTime: "asc" },
          select: {
            id: true,
            startTime: true,
            endTime: true,
          },
        });

        if (dayParents.length === 0) {
          return {
            ok: false,
            error: `No generated ${schedule.type} window exists for this schedule on ${resolvedDate}. Verify working days or publish availability for ${resolvedDate} first.`,
          };
        }

        const currentStartDt = dayParents[0].startTime;
        const currentEndDt = dayParents[dayParents.length - 1].endTime;

        let nextRange: { startTime: Date; endTime: Date };
        try {
          nextRange = calculateElasticRange(
            { startTime: currentStartDt, endTime: currentEndDt },
            edge,
            resolvedSteps,
            schedule.durationMinutes,
            mode
          );
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : `Cannot ${mode.toLowerCase()} schedule window by ${resolvedSteps} block(s).`,
          };
        }

        const now = new Date();
        if (nextRange.endTime.getTime() <= now.getTime()) {
          return {
            ok: false,
            error: "Cannot change this window because the target time range has already ended.",
          };
        }

        const diff = diffAvailabilityIntervals(
          { startTime: currentStartDt, endTime: currentEndDt },
          nextRange,
          schedule.durationMinutes
        );

        if (mode === "EXPAND" && diff.added.length > 0) {
          const pastAdded = diff.added.find(
            (interval) => interval.startTime.getTime() <= now.getTime()
          );
          if (pastAdded) {
            return {
              ok: false,
              error: `Cannot expand backward into a time interval that already started (${formatTimeIST(pastAdded.startTime)}–${formatTimeIST(pastAdded.endTime)} IST on ${resolvedDate}).`,
            };
          }

          const addedMinStart = diff.added[0].startTime;
          const addedMaxEnd = diff.added[diff.added.length - 1].endTime;

          const overlappingTimeOff = await db.doctorTimeOff.findFirst({
            where: {
              doctorId: ctx.doctorId,
              startAt: { lt: addedMaxEnd },
              endAt: { gt: addedMinStart },
            },
            select: {
              reason: true,
              startAt: true,
              endAt: true,
            },
          });
          if (overlappingTimeOff) {
            const hitsAdded = diff.added.some(
              (interval) =>
                overlappingTimeOff.startAt < interval.endTime &&
                overlappingTimeOff.endAt > interval.startTime
            );
            if (hitsAdded) {
              return {
                ok: false,
                error: `Cannot expand into ${resolvedDate} because it overlaps your scheduled time off${
                  overlappingTimeOff.reason ? ` (${overlappingTimeOff.reason})` : ""
                }.`,
              };
            }
          }

          const parentIds = dayParents.map((p) => p.id);
          const candidateOverlaps = await db.availability.findMany({
            where: {
              doctorId: ctx.doctorId,
              status: { not: SlotStatus.BLOCKED },
              kind: {
                in: [
                  AvailabilityKind.SINGLE,
                  AvailabilityKind.WAVE_PARENT,
                  AvailabilityKind.STREAM_WINDOW,
                ],
              },
              id: { notIn: parentIds },
              startTime: { lt: addedMaxEnd },
              endTime: { gt: addedMinStart },
            },
            select: {
              startTime: true,
              endTime: true,
            },
          });

          const colliding = candidateOverlaps.find((other) =>
            diff.added.some(
              (interval) =>
                other.startTime < interval.endTime &&
                other.endTime > interval.startTime
            )
          );
          if (colliding) {
            return {
              ok: false,
              error: `Cannot expand because the new hours overlap an existing active window or slot (${formatSlotTimeRangeIST(colliding.startTime, colliding.endTime)}).`,
            };
          }
        }

        const currentStartStr = formatTimeIST(currentStartDt);
        const currentEndStr = formatTimeIST(currentEndDt);
        const nextStartStr = formatTimeIST(nextRange.startTime);
        const nextEndStr = formatTimeIST(nextRange.endTime);
        const nextStartHHmm = getISTHHmm(nextRange.startTime);
        const nextEndHHmm = getISTHHmm(nextRange.endTime);

        let affectedBookingsCount = 0;
        const activeStatuses = [
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.IN_CONSULTATION,
          AppointmentStatus.PENDING_PAYMENT,
        ];

        const shouldCheckImpact =
          (mode === "SHRINK" && diff.removed.length > 0) ||
          (mode === "EXPAND" && schedule.type === "STREAM" && diff.added.length > 0);

        if (shouldCheckImpact) {
          const bookedInScope = await db.appointment.findMany({
            where: {
              status: { in: activeStatuses },
              availability: {
                doctorId: ctx.doctorId,
                scheduleId: schedule.id,
                startTime: applyToFuture
                  ? { gte: dayRange.start }
                  : { gte: dayRange.start, lt: dayRange.nextDayStart },
              },
            },
            select: {
              slotStart: true,
              slotEnd: true,
              availability: {
                select: {
                  startTime: true,
                  endTime: true,
                },
              },
            },
          });

          if (mode === "SHRINK") {
            affectedBookingsCount = bookedInScope.filter((b) => {
              if (schedule.type === "STREAM") {
                return true;
              }
              const w = effectiveSlot(b);
              const d = getISTDateString(w.start);
              const cutStart = parseISTDateTime(d, nextStartHHmm);
              const cutEnd = parseISTDateTime(d, nextEndHHmm);
              return w.start < cutStart || w.end > cutEnd;
            }).length;
          } else {
            affectedBookingsCount = bookedInScope.filter(
              (b) => b.slotStart === null && b.slotEnd === null
            ).length;
          }
        }

        const action =
          mode === "SHRINK"
            ? "DOCTOR_SHRINK_AVAILABILITY"
            : "DOCTOR_EXPAND_AVAILABILITY";

        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "DOCTOR",
          action,
          payload: {
            scheduleId: schedule.id,
            date: resolvedDate,
            edge,
            steps: resolvedSteps,
            applyToFuture,
          },
          title: `${mode === "SHRINK" ? "Shrink" : "Expand"} ${schedule.type} Availability`,
          summary: `${mode === "SHRINK" ? "Shrink" : "Expand"} ${edge} by ${resolvedSteps} block(s) (${nextStartStr}–${nextEndStr} IST)${
            applyToFuture ? " from " + resolvedDate + " onward" : " on " + resolvedDate
          }`,
          details: [
            {
              label: "Schedule",
              value: `${schedule.type} (${minutesToHHmm(schedule.startMinute)}–${minutesToHHmm(schedule.endMinute)} IST, ${schedule.durationMinutes} min blocks)`,
            },
            { label: "Current Day Window", value: `${currentStartStr}–${currentEndStr}` },
            { label: "Target Window", value: `${nextStartStr}–${nextEndStr}` },
            {
              label: "Scope",
              value: applyToFuture
                ? `${resolvedDate} and future matching days`
                : `${resolvedDate} only`,
            },
            ...(mode === "SHRINK" || affectedBookingsCount > 0
              ? [
                  {
                    label: "Affected Bookings",
                    value: `${affectedBookingsCount} active appointment(s) will need patient rescheduling`,
                  },
                ]
              : []),
          ],
          warning:
            affectedBookingsCount > 0
              ? `${affectedBookingsCount} booked appointment(s) remain protected while affected patients receive rescheduling notifications.`
              : undefined,
          confirmLabel: mode === "SHRINK" ? "Confirm Shrink" : "Confirm Expand",
        });

        return {
          ok: true,
          requiresConfirmation: true,
          affectedBookingsCount,
          confirmation,
        };
      },
    }),

    prepareBlockOrUnblockDate: tool({
      description:
        "Stage a signed confirmation card to block or unblock all availability on a specific date for a schedule.",
      inputSchema: z.object({
        mode: z.enum(["BLOCK", "UNBLOCK"]),
        scheduleId: z.string().min(1),
        date: z.string().describe("IST date ('today', 'tomorrow', or YYYY-MM-DD)."),
        confirmCancellation: z.boolean().default(false),
      }),
      execute: async ({ mode, scheduleId, date, confirmCancellation }) => {
        if (ctx.doctorStatus !== DoctorStatus.APPROVED) {
          return { ok: false, error: "Doctor profile must be APPROVED." };
        }
        const resolvedDate = resolveISTDateInput(date);
        if (!resolvedDate) {
          return { ok: false, error: "Invalid IST date." };
        }

        const schedule = await db.availabilitySchedule.findFirst({
          where: { id: scheduleId, doctorId: ctx.doctorId },
          select: { id: true, type: true, startMinute: true, endMinute: true },
        });
        if (!schedule) {
          return { ok: false, error: "Schedule not found for your account." };
        }

        const dayRange = getISTDayRangeUTC(resolvedDate);
        const activeBookings = await db.appointment.count({
          where: {
            status: {
              in: [
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.CHECKED_IN,
                AppointmentStatus.PENDING_PAYMENT,
              ],
            },
            availability: {
              doctorId: ctx.doctorId,
              scheduleId: schedule.id,
              startTime: { gte: dayRange.start, lt: dayRange.nextDayStart },
            },
          },
        });

        const schedWindow = `${minutesToHHmm(schedule.startMinute)}–${minutesToHHmm(schedule.endMinute)}`;
        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "DOCTOR",
          action:
            mode === "BLOCK"
              ? "DOCTOR_BLOCK_SCHEDULE_DATE"
              : "DOCTOR_UNBLOCK_SCHEDULE_DATE",
          payload:
            mode === "BLOCK"
              ? { scheduleId: schedule.id, date: resolvedDate, confirmCancellation }
              : { scheduleId: schedule.id, date: resolvedDate },
          title: `${mode === "BLOCK" ? "Block" : "Unblock"} Schedule Date`,
          summary: `${mode === "BLOCK" ? "Block" : "Unblock"} ${schedWindow} on ${resolvedDate}`,
          details: [
            { label: "Schedule", value: `${schedule.type} (${schedWindow})` },
            { label: "Date", value: resolvedDate },
            { label: "Active Bookings", value: String(activeBookings) },
          ],
          warning:
            mode === "BLOCK" && activeBookings > 0
              ? confirmCancellation
                ? `Blocking will cancel ${activeBookings} active booking(s) and trigger automatic refunds where applicable.`
                : `${activeBookings} active booking(s) exist on this date. Blocking without cancellation confirmation will be rejected.`
              : undefined,
          confirmLabel:
            mode === "BLOCK" ? "Confirm Block Date" : "Confirm Unblock Date",
        });

        return { ok: true, requiresConfirmation: true, activeBookings, confirmation };
      },
    }),

    prepareToggleSlotBlock: tool({
      description:
        "Stage a signed confirmation card to block or unblock a single individual availability slot.",
      inputSchema: z.object({
        slotId: z.string().min(1),
      }),
      execute: async ({ slotId }) => {
        if (ctx.doctorStatus !== DoctorStatus.APPROVED) {
          return { ok: false, error: "Doctor profile must be APPROVED." };
        }
        const slot = await db.availability.findFirst({
          where: { id: slotId, doctorId: ctx.doctorId },
          select: {
            id: true,
            status: true,
            startTime: true,
            endTime: true,
            activeCount: true,
          },
        });
        if (!slot) {
          return { ok: false, error: "Slot not found for your account." };
        }

        const nextAction = slot.status === SlotStatus.BLOCKED ? "Unblock" : "Block";
        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "DOCTOR",
          action: "DOCTOR_TOGGLE_BLOCK_SLOT",
          payload: { slotId: slot.id },
          title: `${nextAction} Slot`,
          summary: `${nextAction} slot on ${formatDateIST(slot.startTime)} (${formatSlotTimeRangeIST(slot.startTime, slot.endTime)})`,
          details: [
            { label: "Date", value: formatDateIST(slot.startTime) },
            {
              label: "Time",
              value: formatSlotTimeRangeIST(slot.startTime, slot.endTime),
            },
            { label: "Current Status", value: slot.status },
            { label: "Active Bookings", value: String(slot.activeCount) },
          ],
          confirmLabel: `Confirm ${nextAction}`,
        });

        return { ok: true, requiresConfirmation: true, confirmation };
      },
    }),

    prepareCreateSchedule: tool({
      description:
        "Preview and stage a signed confirmation card to create a new recurring or non-recurring Wave/Stream consultation schedule.",
      inputSchema: z.object({
        type: z.enum(["WAVE", "STREAM"]),
        recurrence: z.enum(["ONCE", "RECURRING"]),
        startDate: z.string().describe("IST date ('today', 'tomorrow', or YYYY-MM-DD)."),
        endDate: z
          .string()
          .optional()
          .describe("End IST date (YYYY-MM-DD). Defaults to startDate when ONCE."),
        daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        durationMinutes: z.number().int().min(5).max(240).default(30),
        capacity: z.number().int().min(1).max(500).default(4),
        confirmOverrideCancellation: z.boolean().default(false),
      }),
      execute: async (input) => {
        if (ctx.doctorStatus !== DoctorStatus.APPROVED) {
          return {
            ok: false,
            error: "Doctor profile must be APPROVED to create schedules.",
          };
        }

        const startDate = resolveISTDateInput(input.startDate);
        const endDate = resolveISTDateInput(input.endDate ?? input.startDate);
        if (!startDate || !endDate) {
          return { ok: false, error: "Invalid startDate or endDate." };
        }

        const startMinute = hhmmToMinutes(input.startTime);
        const endMinute = hhmmToMinutes(input.endTime);
        if (startMinute === null || endMinute === null || endMinute <= startMinute) {
          return {
            ok: false,
            error: "Provide valid 24-hour HH:mm times with endTime after startTime.",
          };
        }

        const daysOfWeek =
          input.daysOfWeek.length > 0
            ? input.daysOfWeek
            : [parseISTDateTime(startDate, "00:00").getUTCDay()];

        const scheduleInput = {
          type: input.type,
          recurrence: input.recurrence,
          startDate,
          endDate,
          daysOfWeek,
          startMinute,
          endMinute,
          durationMinutes: input.durationMinutes,
          capacity: input.capacity,
        };

        const preview = await previewScheduleAction(scheduleInput);
        if (!preview.success || !("count" in preview)) {
          return {
            ok: false,
            error:
              ("error" in preview && preview.error) ||
              "Unable to preview this schedule configuration.",
          };
        }

        const overrideCount = Array.isArray(preview.overrides)
          ? preview.overrides.length
          : 0;
        const skippedCount = Array.isArray(preview.skippedDates)
          ? preview.skippedDates.length
          : 0;

        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "DOCTOR",
          action: "DOCTOR_CREATE_SCHEDULE",
          payload: {
            ...scheduleInput,
            confirmOverrideCancellation: input.confirmOverrideCancellation,
          },
          title: `Create ${input.type} ${input.recurrence === "ONCE" ? "Non-recurring" : "Recurring"} Schedule`,
          summary: `${input.startTime}–${input.endTime} IST (${preview.count} slot row(s))`,
          details: [
            { label: "Schedule", value: `${input.type} (${input.recurrence})` },
            { label: "Dates", value: `${startDate} to ${endDate}` },
            { label: "Time Window", value: `${input.startTime} – ${input.endTime} IST` },
            {
              label: "Generated Rows",
              value: `${preview.count} availability day(s) (${preview.subSlots ?? preview.count} sub-slots)`,
            },
            { label: "Seat Capacity", value: String(input.capacity) },
          ],
          warning:
            overrideCount > 0 || skippedCount > 0
              ? `Overrides ${overrideCount} date(s), skips ${skippedCount} date(s).`
              : undefined,
          confirmLabel: "Create Schedule",
        });

        return { ok: true, requiresConfirmation: true, preview, confirmation };
      },
    }),

    prepareTimeOffChange: tool({
      description:
        "Stage a signed confirmation card to record doctor leave / time off or delete an existing time off entry.",
      inputSchema: z.object({
        mode: z.enum(["CREATE", "DELETE"]),
        date: z
          .string()
          .optional()
          .describe("IST date for CREATE ('today', 'tomorrow', YYYY-MM-DD)."),
        startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        isFullDay: z.boolean().default(true),
        reason: z.string().max(500).optional(),
        timeOffId: z.string().optional().describe("Required for DELETE."),
      }),
      execute: async (input) => {
        if (ctx.doctorStatus !== DoctorStatus.APPROVED) {
          return { ok: false, error: "Doctor profile must be APPROVED." };
        }

        if (input.mode === "DELETE") {
          if (!input.timeOffId) {
            return {
              ok: false,
              error: "timeOffId is required to delete time off.",
            };
          }
          const existing = await db.doctorTimeOff.findFirst({
            where: { id: input.timeOffId, doctorId: ctx.doctorId },
          });
          if (!existing) {
            return {
              ok: false,
              error: "Time-off entry not found for your account.",
            };
          }
          const confirmation = await createPendingConfirmation({
            userId: ctx.userId,
            role: "DOCTOR",
            action: "DOCTOR_DELETE_TIME_OFF",
            payload: { id: existing.id },
            title: "Remove Scheduled Time Off",
            summary: `Restore slots covered by leave on ${formatDateIST(existing.startAt)}`,
            details: [
              { label: "Date", value: formatDateIST(existing.startAt) },
              {
                label: "Window",
                value: formatSlotTimeRangeIST(existing.startAt, existing.endAt),
              },
              ...(existing.reason
                ? [{ label: "Reason", value: existing.reason }]
                : []),
            ],
            confirmLabel: "Delete Time Off",
          });
          return { ok: true, requiresConfirmation: true, confirmation };
        }

        const resolvedDate = resolveISTDateInput(input.date);
        if (!resolvedDate) {
          return {
            ok: false,
            error: "Please specify a valid IST date for time off.",
          };
        }

        const dayRange = getISTDayRangeUTC(resolvedDate);
        const rangeStart = input.isFullDay
          ? parseISTDateTime(resolvedDate, "00:00")
          : parseISTDateTime(resolvedDate, input.startTime ?? "00:00");
        const rangeEnd = input.isFullDay
          ? dayRange.end
          : parseISTDateTime(resolvedDate, input.endTime ?? "23:59");

        if (
          !input.isFullDay &&
          (!input.startTime || !input.endTime || rangeEnd <= rangeStart)
        ) {
          return {
            ok: false,
            error:
              "Provide valid startTime and endTime for partial-day time off.",
          };
        }

        const activeAppts = await db.appointment.findMany({
          where: {
            status: {
              in: [
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.CHECKED_IN,
                AppointmentStatus.PENDING_PAYMENT,
              ],
            },
            availability: {
              doctorId: ctx.doctorId,
              startTime: {
                gte: dayRange.start,
                lt: dayRange.nextDayStart,
              },
            },
          },
          include: {
            availability: { select: { startTime: true, endTime: true } },
          },
        });

        const overlappingCount = activeAppts.filter((a) => {
          const w = effectiveSlot(a);
          return w.start < rangeEnd && w.end > rangeStart;
        }).length;

        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "DOCTOR",
          action: "DOCTOR_CREATE_TIME_OFF",
          payload: {
            startAt: rangeStart.toISOString(),
            endAt: rangeEnd.toISOString(),
            ...(input.reason ? { reason: input.reason } : {}),
          },
          title: "Confirm Doctor Time Off",
          summary: `${input.isFullDay ? "Full day leave" : `${input.startTime}–${input.endTime} leave`} on ${resolvedDate}`,
          details: [
            { label: "Date", value: resolvedDate },
            {
              label: "Window",
              value: input.isFullDay
                ? "Full Day"
                : `${input.startTime} – ${input.endTime}`,
            },
            ...(input.reason ? [{ label: "Reason", value: input.reason }] : []),
            { label: "Overlapping Bookings", value: String(overlappingCount) },
          ],
          warning:
            overlappingCount > 0
              ? `This time off overlaps ${overlappingCount} active appointment(s), which will be cancelled/refunded per clinic absence policy.`
              : undefined,
          confirmLabel: "Save Time Off",
        });

        return {
          ok: true,
          requiresConfirmation: true,
          overlappingCount,
          confirmation,
        };
      },
    }),

    prepareDoctorAppointmentAction: tool({
      description:
        "Stage a signed confirmation card to cancel, mark completed, mark no-show, reschedule, or manually resolve one of the doctor's appointments.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
        action: z.enum([
          "CANCEL",
          "COMPLETE",
          "MARK_NO_SHOW",
          "RESCHEDULE",
          "RESOLVE_MANUALLY",
        ]),
        newAvailabilityId: z
          .string()
          .optional()
          .describe("Required when action is RESCHEDULE."),
        reason: z.string().max(500).optional(),
      }),
      execute: async ({ appointmentId, action, newAvailabilityId, reason }) => {
        const appt = await db.appointment.findFirst({
          where: {
            id: appointmentId,
            availability: { doctorId: ctx.doctorId },
          },
          include: {
            patient: { select: { user: { select: { name: true } } } },
            availability: { select: { startTime: true, endTime: true } },
            payments: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true, amount: true },
            },
          },
        });

        if (!appt) {
          return {
            ok: false,
            error: "Appointment not found for your doctor profile.",
          };
        }

        const window = effectiveSlot(appt);
        const patientName = appt.patient.user.name || "Patient";
        const latestPayment = appt.payments[0] ?? null;
        const dateTimeLabel = `${formatDateIST(window.start)} • ${formatSlotTimeRangeIST(window.start, window.end)}`;

        if (action === "CANCEL") {
          if (
            !isValidTransition(
              appt.status,
              AppointmentStatus.CANCELLED,
              Role.DOCTOR
            )
          ) {
            return {
              ok: false,
              error: `Cannot cancel an appointment in ${appt.status} status.`,
            };
          }
          const confirmation = await createPendingConfirmation({
            userId: ctx.userId,
            role: "DOCTOR",
            action: "DOCTOR_CANCEL_APPOINTMENT",
            payload: { appointmentId: appt.id },
            title: `Cancel ${patientName}'s Appointment`,
            summary: dateTimeLabel,
            details: [
              { label: "Patient", value: patientName },
              { label: "Slot", value: dateTimeLabel },
              ...(latestPayment
                ? [
                    {
                      label: "Payment",
                      value: `${formatRupeesFromDecimal(latestPayment.amount)} (${latestPayment.status})`,
                    },
                  ]
                : []),
            ],
            warning:
              latestPayment?.status === "PAID"
                ? "Doctor-initiated cancellation triggers a 100% patient refund."
                : undefined,
            confirmLabel: "Cancel Appointment",
          });
          return { ok: true, requiresConfirmation: true, confirmation };
        }

        if (action === "COMPLETE") {
          if (
            !isValidTransition(
              appt.status,
              AppointmentStatus.COMPLETED,
              Role.DOCTOR
            )
          ) {
            return {
              ok: false,
              error: `Cannot mark ${appt.status} appointment as COMPLETED.`,
            };
          }
          const confirmation = await createPendingConfirmation({
            userId: ctx.userId,
            role: "DOCTOR",
            action: "DOCTOR_COMPLETE_APPOINTMENT",
            payload: { appointmentId: appt.id },
            title: `Complete Consultation – ${patientName}`,
            summary: dateTimeLabel,
            details: [
              { label: "Patient", value: patientName },
              { label: "Slot", value: dateTimeLabel },
            ],
            confirmLabel: "Mark Completed",
          });
          return { ok: true, requiresConfirmation: true, confirmation };
        }

        if (action === "MARK_NO_SHOW") {
          if (
            !isValidTransition(
              appt.status,
              AppointmentStatus.NO_SHOW,
              Role.DOCTOR
            )
          ) {
            return {
              ok: false,
              error: `Cannot mark ${appt.status} appointment as NO_SHOW.`,
            };
          }
          const confirmation = await createPendingConfirmation({
            userId: ctx.userId,
            role: "DOCTOR",
            action: "DOCTOR_MARK_NO_SHOW",
            payload: { appointmentId: appt.id },
            title: `Mark No-Show – ${patientName}`,
            summary: dateTimeLabel,
            details: [
              { label: "Patient", value: patientName },
              { label: "Slot", value: dateTimeLabel },
            ],
            confirmLabel: "Mark No-Show",
          });
          return { ok: true, requiresConfirmation: true, confirmation };
        }

        if (action === "RESOLVE_MANUALLY") {
          const confirmation = await createPendingConfirmation({
            userId: ctx.userId,
            role: "DOCTOR",
            action: "DOCTOR_RESOLVE_DISRUPTED_MANUALLY",
            payload: {
              appointmentId: appt.id,
              ...(reason ? { resolutionNote: reason } : {}),
            },
            title: `Resolve Disrupted Appointment – ${patientName}`,
            summary: dateTimeLabel,
            details: [
              { label: "Patient", value: patientName },
              { label: "Slot", value: dateTimeLabel },
              ...(reason ? [{ label: "Note", value: reason }] : []),
            ],
            confirmLabel: "Resolve Manually",
          });
          return { ok: true, requiresConfirmation: true, confirmation };
        }

        if (!newAvailabilityId) {
          return {
            ok: false,
            error: "Please specify newAvailabilityId when rescheduling.",
          };
        }
        const target = await db.availability.findFirst({
          where: { id: newAvailabilityId, doctorId: ctx.doctorId },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            status: true,
            activeCount: true,
            capacity: true,
          },
        });
        if (
          !target ||
          target.status === SlotStatus.BLOCKED ||
          target.activeCount >= target.capacity
        ) {
          return {
            ok: false,
            error: "Target slot is not available for rescheduling.",
          };
        }

        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "DOCTOR",
          action: "DOCTOR_RESCHEDULE_APPOINTMENT",
          payload: {
            appointmentId: appt.id,
            newAvailabilityId: target.id,
            ...(reason ? { reason } : {}),
          },
          title: `Reschedule ${patientName}`,
          summary: `Move to ${formatDateIST(target.startTime)} (${formatSlotTimeRangeIST(target.startTime, target.endTime)})`,
          details: [
            { label: "Patient", value: patientName },
            { label: "Current Slot", value: dateTimeLabel },
            {
              label: "New Slot",
              value: `${formatDateIST(target.startTime)} • ${formatSlotTimeRangeIST(target.startTime, target.endTime)}`,
            },
          ],
          confirmLabel: "Confirm Reschedule",
        });

        return { ok: true, requiresConfirmation: true, confirmation };
      },
    }),
  };
}
