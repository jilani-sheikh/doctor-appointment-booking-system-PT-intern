import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  AppointmentStatus,
  AvailabilityKind,
  DoctorStatus,
  PaymentStatus,
  RefundReason,
  SlotStatus,
} from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPaymentsMode } from "@/lib/env";
import {
  HOLD_MINUTES,
  MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY,
  MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT,
  MAX_SIMULTANEOUS_HOLDS_PER_PATIENT,
} from "@/lib/constants";
import { canPatientCancel, canPatientCheckIn, canPatientReschedule } from "@/lib/appointment-status";
import { calculateRefundPolicy } from "@/lib/refund-policy";
import { discoverAlternativeAppointmentsForPatient } from "@/lib/actions/reschedule";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { effectiveSlot } from "@/lib/scheduling";
import { formatDateIST, getISTDateString, getISTDayRangeUTC } from "@/lib/time";
import { createPendingConfirmation } from "@/lib/ai/confirmation";
import {
  formatRupeesFromDecimal,
  formatSlotTimeRangeIST,
  resolveISTDateInput,
} from "@/lib/ai/helpers";
import type {
  AppointmentCardData,
  AssistantCard,
  DoctorCardData,
  SlotOptionData,
} from "@/lib/ai/schemas";

export interface PatientToolContext {
  userId: string;
  patientId: string;
  patientName: string;
}

const BOOKABLE_KINDS: AvailabilityKind[] = [
  AvailabilityKind.SINGLE,
  AvailabilityKind.WAVE_SLOT,
  AvailabilityKind.STREAM_WINDOW,
];

function isPaymentsEnabledForFee(feeRupees: number): boolean {
  return getPaymentsMode() === "cashfree" && feeRupees > 0;
}

export function createPatientTools(ctx: PatientToolContext) {
  return {
    getMyAppointments: tool({
      description:
        "Retrieve the signed-in patient's appointments (upcoming, next upcoming, disrupted needing reschedule, past, or for a specific date). Returns structured appointment cards with queue/wave info, disruption alert, and payment status.",
      inputSchema: z.object({
        scope: z
          .enum(["upcoming", "next", "disrupted", "past", "all"])
          .default("upcoming")
          .describe("Which set of appointments to retrieve."),
        date: z
          .string()
          .optional()
          .describe("Optional IST date filter ('today', 'tomorrow', or YYYY-MM-DD)."),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ scope, date, limit }) => {
        const now = new Date();
        const resolvedDate = resolveISTDateInput(date);
        const dayRange = resolvedDate ? getISTDayRangeUTC(resolvedDate) : null;

        const appointments = await db.appointment.findMany({
          where: {
            patientId: ctx.patientId,
            ...(dayRange
              ? {
                  availability: {
                    startTime: {
                      gte: dayRange.start,
                      lt: dayRange.nextDayStart,
                    },
                  },
                }
              : {}),
          },
          include: {
            availability: {
              select: {
                id: true,
                startTime: true,
                endTime: true,
                kind: true,
                doctor: {
                  select: {
                    id: true,
                    specialization: true,
                    consultationFee: true,
                    user: { select: { name: true } },
                  },
                },
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
              startTime: scope === "past" ? "desc" : "asc",
            },
          },
          take: 50,
        });

        const filtered = appointments.filter((appt) => {
          const window = effectiveSlot(appt);
          if (scope === "disrupted") {
            return (
              appt.disruptedAt !== null &&
              appt.rescheduleStatus === "PENDING_RESCHEDULING"
            );
          }
          if (scope === "upcoming" || scope === "next") {
            const isActive =
              appt.status === AppointmentStatus.CONFIRMED ||
              appt.status === AppointmentStatus.CHECKED_IN ||
              appt.status === AppointmentStatus.IN_CONSULTATION ||
              appt.status === AppointmentStatus.PENDING_PAYMENT;
            return isActive && window.end >= now;
          }
          if (scope === "past") {
            const isPastStatus =
              appt.status === AppointmentStatus.COMPLETED ||
              appt.status === AppointmentStatus.CANCELLED ||
              appt.status === AppointmentStatus.NO_SHOW;
            return isPastStatus || window.end < now;
          }
          return true;
        });

        const sliced = filtered.slice(0, scope === "next" ? 1 : limit);

        const items: AppointmentCardData[] = sliced.map((appt) => {
          const window = effectiveSlot(appt);
          const latestPayment = appt.payments[0] ?? null;
          const doctorName = appt.availability.doctor.user.name || "Doctor";
          const checkIn = canPatientCheckIn({
            status: appt.status,
            startTime: window.start,
            endTime: window.end,
          });
          const cancelCheck = canPatientCancel({
            status: appt.status,
            startTime: window.start,
            disruptedAt: appt.disruptedAt,
          });
          const rescheduleCheck = canPatientReschedule({
            status: appt.status,
            startTime: window.start,
            rescheduleCount: appt.rescheduleCount,
            disruptedAt: appt.disruptedAt,
          });

          return {
            id: appt.id,
            status: appt.status,
            rescheduleStatus: appt.rescheduleStatus,
            disruptedAt: appt.disruptedAt ? appt.disruptedAt.toISOString() : null,
            disruptionReason: appt.disruptionReason,
            doctorId: appt.availability.doctor.id,
            doctorName,
            doctorSpecialization: appt.availability.doctor.specialization,
            patientName: ctx.patientName,
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
              : formatRupeesFromDecimal(appt.availability.doctor.consultationFee),
            requiresPaymentResume:
              appt.status === AppointmentStatus.PENDING_PAYMENT &&
              appt.holdExpiresAt !== null &&
              appt.holdExpiresAt > now,
            canCheckIn: checkIn.allowed,
            canCancel:
              appt.status === AppointmentStatus.PENDING_PAYMENT ||
              cancelCheck.allowed,
            canReschedule: rescheduleCheck.allowed,
            availabilityId: appt.availability.id,
            notes: appt.reason,
          };
        });

        const title =
          scope === "next"
            ? "Next Appointment"
            : scope === "disrupted"
              ? "Disrupted Appointments"
              : scope === "past"
                ? "Previous Appointments"
                : scope === "all"
                  ? "Your Appointments"
                  : "Upcoming Appointments";

        const card: AssistantCard = {
          type: "appointment_list",
          title,
          viewerRole: "PATIENT",
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

    searchDoctors: tool({
      description:
        "Search approved Medrella doctors by name, specialization, or maximum fee, including their earliest upcoming open slot.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Doctor name or keyword filter."),
        specialization: z
          .string()
          .optional()
          .describe("Medical specialization filter, e.g., Cardiology, Dermatology."),
        maxFeeRupees: z
          .number()
          .nonnegative()
          .optional()
          .describe("Maximum consultation fee in INR."),
        limit: z.number().int().min(1).max(12).default(6),
      }),
      execute: async ({ query, specialization, maxFeeRupees, limit }) => {
        const now = new Date();
        const leadCutoff = new Date(now.getTime() + 60 * 60 * 1000);
        const searchTerm = query?.trim();
        const specTerm = specialization?.trim();

        const doctors = await db.doctor.findMany({
          where: {
            status: DoctorStatus.APPROVED,
            user: {
              deletedAt: null,
            },
            ...(maxFeeRupees !== undefined
              ? {
                  consultationFee: {
                    lte: maxFeeRupees,
                  },
                }
              : {}),
            ...(specTerm
              ? {
                  specialization: {
                    contains: specTerm,
                    mode: "insensitive",
                  },
                }
              : {}),
            ...(searchTerm
              ? {
                  OR: [
                    { user: { name: { contains: searchTerm, mode: "insensitive" } } },
                    { specialization: { contains: searchTerm, mode: "insensitive" } },
                    { qualification: { contains: searchTerm, mode: "insensitive" } },
                  ],
                }
              : {}),
          },
          include: {
            user: {
              select: { name: true },
            },
            availabilities: {
              where: {
                status: SlotStatus.AVAILABLE,
                kind: { in: BOOKABLE_KINDS },
                startTime: { gte: leadCutoff },
              },
              orderBy: { startTime: "asc" },
              take: 8,
            },
          },
          orderBy: [{ experienceYears: "desc" }, { createdAt: "asc" }],
          take: limit,
        });

        const items: DoctorCardData[] = doctors.map((doc) => {
          const openSlot = doc.availabilities.find(
            (slot) => slot.activeCount < slot.capacity
          );
          return {
            id: doc.id,
            name: doc.user.name || "Doctor",
            specialization: doc.specialization,
            qualification: doc.qualification,
            experienceYears: doc.experienceYears,
            consultationFeeRupees: Number(doc.consultationFee),
            bio: doc.bio,
            nextAvailableDateIST: openSlot ? formatDateIST(openSlot.startTime) : null,
            nextAvailableTimeIST: openSlot
              ? formatSlotTimeRangeIST(openSlot.startTime, openSlot.endTime)
              : null,
          };
        });

        const card: AssistantCard = {
          type: "doctor_list",
          title: "Available Doctors",
          items,
        };

        return {
          ok: true,
          count: items.length,
          doctors: items,
          card,
        };
      },
    }),

    getDoctorAvailableSlots: tool({
      description:
        "List bookable upcoming slots for a specific approved doctor (optionally filtered by date). Excludes past/full/blocked slots and Wave parent rows.",
      inputSchema: z.object({
        doctorId: z.string().min(1),
        date: z
          .string()
          .optional()
          .describe("Optional IST date ('today', 'tomorrow', or YYYY-MM-DD)."),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ doctorId, date, limit }) => {
        const doctor = await db.doctor.findFirst({
          where: {
            id: doctorId,
            status: DoctorStatus.APPROVED,
            user: { deletedAt: null },
          },
          select: {
            id: true,
            specialization: true,
            consultationFee: true,
            user: { select: { name: true } },
          },
        });

        if (!doctor) {
          return {
            ok: false,
            error: "Doctor not found or not currently available for booking.",
          };
        }

        const doctorName = doctor.user.name || "Doctor";
        const now = new Date();
        const leadCutoff = new Date(now.getTime() + 60 * 60 * 1000);
        const resolvedDate = resolveISTDateInput(date);
        const dayRange = resolvedDate ? getISTDayRangeUTC(resolvedDate) : null;

        const rawSlots = await db.availability.findMany({
          where: {
            doctorId: doctor.id,
            status: SlotStatus.AVAILABLE,
            kind: { in: BOOKABLE_KINDS },
            startTime: dayRange
              ? {
                  gte: new Date(Math.max(leadCutoff.getTime(), dayRange.start.getTime())),
                  lt: dayRange.nextDayStart,
                }
              : { gte: leadCutoff },
          },
          orderBy: { startTime: "asc" },
          take: limit * 2,
        });

        const feeRupees = Number(doctor.consultationFee);
        const slots: SlotOptionData[] = rawSlots
          .filter((s) => s.activeCount < s.capacity)
          .slice(0, limit)
          .map((s) => ({
            availabilityId: s.id,
            doctorId: doctor.id,
            doctorName,
            doctorSpecialization: doctor.specialization,
            dateIST: formatDateIST(s.startTime),
            timeRangeIST: formatSlotTimeRangeIST(s.startTime, s.endTime),
            kind: s.kind,
            capacity: s.capacity,
            activeCount: s.activeCount,
            remainingSeats: Math.max(0, s.capacity - s.activeCount),
            consultationFeeRupees: feeRupees,
          }));

        const card: AssistantCard = {
          type: "slot_selector",
          title: `Open Slots – Dr. ${doctorName}`,
          mode: "BOOK",
          doctorId: doctor.id,
          doctorName,
          slots,
        };

        return {
          ok: true,
          doctorName,
          specialization: doctor.specialization,
          consultationFeeRupees: feeRupees,
          slots,
          card,
        };
      },
    }),

    suggestAlternativeSlots: tool({
      description:
        "Discover recommended 3-level alternative slots for one of the patient's appointments using Medrella's elastic rescheduling engine.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
      }),
      execute: async ({ appointmentId }) => {
        const appt = await db.appointment.findFirst({
          where: { id: appointmentId, patientId: ctx.patientId },
          include: {
            availability: {
              select: {
                doctor: {
                  select: {
                    id: true,
                    consultationFee: true,
                    user: { select: { name: true } },
                  },
                },
              },
            },
          },
        });

        if (!appt) {
          return { ok: false, error: "Appointment not found for your account." };
        }

        const result = await discoverAlternativeAppointmentsForPatient(appt.id);
        const feeRupees = Number(appt.availability.doctor.consultationFee);
        const doctorName = appt.availability.doctor.user.name || "Doctor";

        const formatItem = (
          item: (typeof result.sameDayAlternatives)[number],
          categoryLabel: string
        ): SlotOptionData => ({
          availabilityId: item.id,
          doctorId: item.doctorId,
          doctorName: item.doctorName,
          doctorSpecialization: item.specialization,
          dateIST: formatDateIST(new Date(item.startTime)),
          timeRangeIST: formatSlotTimeRangeIST(
            new Date(item.startTime),
            new Date(item.endTime)
          ),
          kind: item.kind,
          capacity: item.capacity,
          activeCount: item.activeCount,
          remainingSeats: Math.max(0, item.capacity - item.activeCount),
          consultationFeeRupees: feeRupees,
          categoryLabel,
        });

        const slots: SlotOptionData[] = [
          ...result.sameDayAlternatives.map((s) =>
            formatItem(s, "Same-day Same Doctor")
          ),
          ...result.upcomingDateAlternatives.map((s) =>
            formatItem(s, "Upcoming Same Doctor")
          ),
          ...result.otherDoctorAlternatives.map((s) =>
            formatItem(s, "Other Clinic Doctor")
          ),
        ];

        const card: AssistantCard = {
          type: "slot_selector",
          title: "Recommended Alternative Slots",
          mode: "PATIENT_RESCHEDULE",
          doctorId: appt.availability.doctor.id,
          doctorName,
          appointmentId: appt.id,
          slots,
        };

        return {
          ok: true,
          totalAlternatives: slots.length,
          slots,
          card,
        };
      },
    }),

    getMyPaymentHistory: tool({
      description:
        "Retrieve the patient's payment records, order IDs, amounts, and linked refund statuses.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ limit }) => {
        const payments = await db.payment.findMany({
          where: {
            appointment: {
              patientId: ctx.patientId,
            },
          },
          include: {
            appointment: {
              select: {
                id: true,
                slotStart: true,
                availability: {
                  select: {
                    startTime: true,
                    doctor: {
                      select: {
                        user: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
            refunds: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                amount: true,
                status: true,
                reason: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        const items = payments.map((p) => {
          const refDate =
            p.appointment?.slotStart ??
            p.appointment?.availability?.startTime ??
            p.createdAt;
          const doctorName =
            p.appointment?.availability?.doctor?.user?.name || "Doctor";
          return {
            id: p.id,
            appointmentId: p.appointmentId,
            doctorName,
            dateIST: formatDateIST(refDate),
            amountDisplay: formatINR(Number(p.amount)),
            status: p.status,
            providerOrderId: p.providerOrderId,
            refunds: p.refunds.map((r) => ({
              id: r.id,
              amountDisplay: formatINR(Number(r.amount)),
              status: r.status,
              reason: r.reason,
            })),
          };
        });

        const card: AssistantCard = {
          type: "payment_list",
          title: "Payments & Refunds",
          items,
        };

        return {
          ok: true,
          count: items.length,
          payments: items,
          card,
        };
      },
    }),

    getMyPrescriptions: tool({
      description:
        "Check if digital prescriptions exist in Medrella for the patient. Always call this instead of inventing prescriptions.",
      inputSchema: z.object({}),
      execute: async () => {
        return {
          ok: true,
          supported: false,
          prescriptions: [],
          message:
            "Digital prescriptions are not available in Medrella yet. Please refer to your printed clinic prescription or ask your doctor directly during consultation.",
        };
      },
    }),

    prepareAppointmentBooking: tool({
      description:
        "Validate eligibility and stage a signed confirmation card to book a specific availability slot for the patient. Does NOT execute booking until user clicks Confirm.",
      inputSchema: z.object({
        availabilityId: z.string().min(1),
        stream: z.enum(["NEW_CONSULTATION", "FOLLOW_UP"]).default("NEW_CONSULTATION"),
        reason: z.string().max(1000).optional(),
      }),
      execute: async ({ availabilityId, stream, reason }) => {
        const now = new Date();
        const leadCutoff = new Date(now.getTime() + 60 * 60 * 1000);

        const slot = await db.availability.findUnique({
          where: { id: availabilityId },
          include: {
            doctor: {
              select: {
                id: true,
                specialization: true,
                consultationFee: true,
                status: true,
                user: { select: { name: true, deletedAt: true } },
              },
            },
          },
        });

        if (
          !slot ||
          slot.doctor.status !== DoctorStatus.APPROVED ||
          slot.doctor.user.deletedAt !== null
        ) {
          return { ok: false, error: "Selected slot or doctor is unavailable." };
        }
        if (slot.kind === AvailabilityKind.WAVE_PARENT) {
          return {
            ok: false,
            error: "Parent wave blocks cannot be booked directly. Pick a child wave slot.",
          };
        }
        if (slot.status === SlotStatus.BLOCKED || slot.activeCount >= slot.capacity) {
          return {
            ok: false,
            error: "This slot is full or blocked. Please select another slot.",
          };
        }
        if (slot.startTime < leadCutoff) {
          return {
            ok: false,
            error: "Bookings must be made at least 1 hour before the consultation start time.",
          };
        }

        const doctorName = slot.doctor.user.name || "Doctor";
        const activeUpcoming = await db.appointment.findMany({
          where: {
            patientId: ctx.patientId,
            status: {
              in: [
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.CHECKED_IN,
                AppointmentStatus.PENDING_PAYMENT,
              ],
            },
          },
          include: {
            availability: { select: { doctorId: true, startTime: true, endTime: true } },
          },
        });

        const futureConfirmedOrCheckedIn = activeUpcoming.filter(
          (a) =>
            (a.status === AppointmentStatus.CONFIRMED ||
              a.status === AppointmentStatus.CHECKED_IN) &&
            effectiveSlot(a).start >= now
        );
        if (
          futureConfirmedOrCheckedIn.length >= MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT
        ) {
          return {
            ok: false,
            error: `You already have ${MAX_ACTIVE_UPCOMING_APPOINTMENTS_PER_PATIENT} active upcoming appointments (maximum allowed).`,
          };
        }

        const targetDateIST = getISTDateString(slot.startTime);
        const sameDoctorSameDay = activeUpcoming.some(
          (a) =>
            a.availability.doctorId === slot.doctorId &&
            (a.status === AppointmentStatus.CONFIRMED ||
              a.status === AppointmentStatus.CHECKED_IN ||
              (a.status === AppointmentStatus.PENDING_PAYMENT &&
                a.holdExpiresAt &&
                a.holdExpiresAt > now)) &&
            getISTDateString(effectiveSlot(a).start) === targetDateIST
        );
        if (sameDoctorSameDay) {
          return {
            ok: false,
            error: `You already have an active appointment with Dr. ${doctorName} on ${formatDateIST(slot.startTime)}. Limit is ${MAX_ACTIVE_APPOINTMENTS_PER_DOCTOR_PER_DAY} per doctor per day.`,
          };
        }

        const feeRupees = Number(slot.doctor.consultationFee);
        const needsPayment = isPaymentsEnabledForFee(feeRupees);

        if (needsPayment) {
          const activeHolds = activeUpcoming.filter(
            (a) =>
              a.status === AppointmentStatus.PENDING_PAYMENT &&
              a.holdExpiresAt &&
              a.holdExpiresAt > now
          );
          if (activeHolds.length >= MAX_SIMULTANEOUS_HOLDS_PER_PATIENT) {
            return {
              ok: false,
              error: `You already have ${MAX_SIMULTANEOUS_HOLDS_PER_PATIENT} pending payment holds. Please complete or cancel an existing hold first.`,
            };
          }
        }

        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "PATIENT",
          action: "PATIENT_BOOK_APPOINTMENT",
          payload: { availabilityId: slot.id, stream, ...(reason ? { reason } : {}) },
          title: `Confirm Booking with Dr. ${doctorName}`,
          summary: `${formatDateIST(slot.startTime)} at ${formatSlotTimeRangeIST(slot.startTime, slot.endTime)}`,
          details: [
            { label: "Doctor", value: `Dr. ${doctorName} (${slot.doctor.specialization})` },
            { label: "Date", value: formatDateIST(slot.startTime) },
            { label: "Time", value: formatSlotTimeRangeIST(slot.startTime, slot.endTime) },
            { label: "Consultation Fee", value: feeRupees > 0 ? formatINR(feeRupees) : "Free" },
            ...(reason ? [{ label: "Reason", value: reason }] : []),
          ],
          warning: needsPayment
            ? `Clicking Confirm will place a ${HOLD_MINUTES}-minute hold and open Cashfree checkout for ${formatINR(feeRupees)}.`
            : undefined,
          confirmLabel: needsPayment ? "Confirm & Pay" : "Confirm Booking",
        });

        return {
          ok: true,
          requiresConfirmation: true,
          confirmation,
        };
      },
    }),

    prepareAppointmentReschedule: tool({
      description:
        "Stage a signed confirmation card to reschedule an existing patient appointment to a specific new availability slot.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
        newAvailabilityId: z.string().min(1),
        reason: z.string().max(500).optional(),
      }),
      execute: async ({ appointmentId, newAvailabilityId, reason }) => {
        const appt = await db.appointment.findFirst({
          where: { id: appointmentId, patientId: ctx.patientId },
          include: {
            availability: {
              select: {
                startTime: true,
                endTime: true,
                doctor: {
                  select: {
                    id: true,
                    specialization: true,
                    consultationFee: true,
                    user: { select: { name: true } },
                  },
                },
              },
            },
          },
        });
        if (!appt) {
          return { ok: false, error: "Appointment not found for your account." };
        }

        const currentWindow = effectiveSlot(appt);
        const reschedCheck = canPatientReschedule({
          status: appt.status,
          startTime: currentWindow.start,
          rescheduleCount: appt.rescheduleCount,
          disruptedAt: appt.disruptedAt,
        });
        if (!reschedCheck.allowed) {
          return {
            ok: false,
            error:
              reschedCheck.reason ||
              "This appointment is no longer eligible for self-service rescheduling.",
          };
        }

        const target = await db.availability.findUnique({
          where: { id: newAvailabilityId },
          include: {
            doctor: {
              select: {
                id: true,
                specialization: true,
                consultationFee: true,
                status: true,
                user: { select: { name: true } },
              },
            },
          },
        });

        if (!target || target.doctor.status !== DoctorStatus.APPROVED) {
          return { ok: false, error: "Selected target slot is unavailable." };
        }
        if (target.status === SlotStatus.BLOCKED || target.activeCount >= target.capacity) {
          return { ok: false, error: "Selected target slot no longer has open capacity." };
        }
        if (target.kind === AvailabilityKind.WAVE_PARENT) {
          return { ok: false, error: "Cannot reschedule directly onto a Wave parent container." };
        }

        const oldDoctorName = appt.availability.doctor.user.name || "Doctor";
        const newDoctorName = target.doctor.user.name || "Doctor";

        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "PATIENT",
          action: "PATIENT_RESCHEDULE_APPOINTMENT",
          payload: {
            appointmentId: appt.id,
            newAvailabilityId: target.id,
            ...(reason ? { reason } : {}),
          },
          title: "Confirm Appointment Reschedule",
          summary: `Move from ${formatDateIST(currentWindow.start)} (${formatSlotTimeRangeIST(currentWindow.start, currentWindow.end)}) to ${formatDateIST(target.startTime)} (${formatSlotTimeRangeIST(target.startTime, target.endTime)})`,
          details: [
            {
              label: "Current Slot",
              value: `${formatDateIST(currentWindow.start)} • ${formatSlotTimeRangeIST(currentWindow.start, currentWindow.end)} (Dr. ${oldDoctorName})`,
            },
            {
              label: "New Slot",
              value: `${formatDateIST(target.startTime)} • ${formatSlotTimeRangeIST(target.startTime, target.endTime)} (Dr. ${newDoctorName})`,
            },
            { label: "Specialization", value: target.doctor.specialization },
          ],
          confirmLabel: "Confirm Reschedule",
        });

        return {
          ok: true,
          requiresConfirmation: true,
          confirmation,
        };
      },
    }),

    prepareAppointmentCancellation: tool({
      description:
        "Preview refund eligibility and stage a signed confirmation card to cancel a patient appointment or active payment hold.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
      }),
      execute: async ({ appointmentId }) => {
        const now = new Date();
        const appt = await db.appointment.findFirst({
          where: { id: appointmentId, patientId: ctx.patientId },
          include: {
            availability: {
              select: {
                startTime: true,
                endTime: true,
                doctor: {
                  select: {
                    specialization: true,
                    user: { select: { name: true } },
                  },
                },
              },
            },
            payments: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                amount: true,
              },
            },
          },
        });

        if (!appt) {
          return { ok: false, error: "Appointment not found for your account." };
        }

        const window = effectiveSlot(appt);
        const doctorName = appt.availability.doctor.user.name || "Doctor";

        if (appt.status === AppointmentStatus.PENDING_PAYMENT) {
          const confirmation = await createPendingConfirmation({
            userId: ctx.userId,
            role: "PATIENT",
            action: "PATIENT_CANCEL_HOLD",
            payload: { appointmentId: appt.id },
            title: "Cancel Pending Payment Hold",
            summary: `Release hold for Dr. ${doctorName} on ${formatDateIST(window.start)}`,
            details: [
              { label: "Doctor", value: `Dr. ${doctorName}` },
              {
                label: "Slot",
                value: `${formatDateIST(window.start)} • ${formatSlotTimeRangeIST(window.start, window.end)}`,
              },
              {
                label: "Refund Impact",
                value: "No captured charge — releases slot immediately.",
              },
            ],
            confirmLabel: "Release Hold",
          });

          return { ok: true, requiresConfirmation: true, confirmation };
        }

        const cancelCheck = canPatientCancel({
          status: appt.status,
          startTime: window.start,
          disruptedAt: appt.disruptedAt,
        });
        if (!cancelCheck.allowed) {
          return {
            ok: false,
            error:
              cancelCheck.reason ||
              "This appointment cannot be cancelled now under clinic policy.",
          };
        }

        let refundSummary = "Free consultation (no refund required).";
        let warning: string | undefined;
        const latestPayment = appt.payments[0] ?? null;

        if (latestPayment && latestPayment.status === PaymentStatus.PAID) {
          const policy = calculateRefundPolicy({
            paidAmountPaise: rupeesToPaise(Number(latestPayment.amount)),
            reason: appt.disruptedAt
              ? RefundReason.DOCTOR_ABSENCE
              : RefundReason.PATIENT_CANCELLED,
            slotStartTime: window.start,
            cancelledAt: now,
          });
          const refundRupees = formatINR(policy.amountRupees);
          refundSummary = `${refundRupees} (${policy.percent}% refund eligibility)`;
          if (policy.percent < 100) {
            warning = `Under clinic cancellation policy, cancelling now qualifies for a ${policy.percent}% refund (${refundRupees}).`;
          }
        }

        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "PATIENT",
          action: "PATIENT_CANCEL_APPOINTMENT",
          payload: { appointmentId: appt.id },
          title: "Confirm Appointment Cancellation",
          summary: `Cancel appointment with Dr. ${doctorName} on ${formatDateIST(window.start)}`,
          details: [
            {
              label: "Doctor",
              value: `Dr. ${doctorName} (${appt.availability.doctor.specialization})`,
            },
            {
              label: "Date & Time",
              value: `${formatDateIST(window.start)} • ${formatSlotTimeRangeIST(window.start, window.end)}`,
            },
            { label: "Estimated Refund", value: refundSummary },
          ],
          warning,
          confirmLabel: "Confirm Cancellation",
        });

        return {
          ok: true,
          requiresConfirmation: true,
          refundPreview: refundSummary,
          confirmation,
        };
      },
    }),

    preparePaymentCheckout: tool({
      description:
        "Stage confirmation to launch Cashfree checkout for a PENDING_PAYMENT appointment hold.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
      }),
      execute: async ({ appointmentId }) => {
        const now = new Date();
        const appt = await db.appointment.findFirst({
          where: { id: appointmentId, patientId: ctx.patientId },
          include: {
            availability: {
              select: {
                startTime: true,
                endTime: true,
                doctor: {
                  select: {
                    consultationFee: true,
                    user: { select: { name: true } },
                  },
                },
              },
            },
            payments: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { amount: true },
            },
          },
        });

        if (!appt) {
          return { ok: false, error: "Appointment not found for your account." };
        }
        if (appt.status !== AppointmentStatus.PENDING_PAYMENT) {
          return {
            ok: false,
            error: "This appointment does not have an active payment hold.",
          };
        }
        if (appt.holdExpiresAt && appt.holdExpiresAt <= now) {
          return {
            ok: false,
            error: "This payment hold has expired. Please book a new slot.",
          };
        }

        const window = effectiveSlot(appt);
        const latestPayment = appt.payments[0] ?? null;
        const doctorName = appt.availability.doctor.user.name || "Doctor";
        const amountRupees = latestPayment
          ? Number(latestPayment.amount)
          : Number(appt.availability.doctor.consultationFee);

        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "PATIENT",
          action: "PATIENT_RESUME_PAYMENT",
          payload: { appointmentId: appt.id },
          title: "Proceed to Cashfree Payment",
          summary: `Pay ${formatINR(amountRupees)} to confirm Dr. ${doctorName}`,
          details: [
            { label: "Doctor", value: `Dr. ${doctorName}` },
            {
              label: "Date & Time",
              value: `${formatDateIST(window.start)} • ${formatSlotTimeRangeIST(window.start, window.end)}`,
            },
            { label: "Amount Due", value: formatINR(amountRupees) },
          ],
          confirmLabel: "Open Cashfree Checkout",
        });

        return { ok: true, requiresConfirmation: true, confirmation };
      },
    }),

    preparePatientCheckIn: tool({
      description:
        "Stage confirmation to check in for a CONFIRMED appointment when within the allowed check-in window.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
      }),
      execute: async ({ appointmentId }) => {
        const appt = await db.appointment.findFirst({
          where: { id: appointmentId, patientId: ctx.patientId },
          include: {
            availability: {
              select: {
                startTime: true,
                endTime: true,
                doctor: {
                  select: { user: { select: { name: true } } },
                },
              },
            },
          },
        });

        if (!appt) {
          return { ok: false, error: "Appointment not found for your account." };
        }

        const window = effectiveSlot(appt);
        const checkIn = canPatientCheckIn({
          status: appt.status,
          startTime: window.start,
          endTime: window.end,
        });
        if (!checkIn.allowed) {
          return {
            ok: false,
            error:
              checkIn.reason ||
              "Check-in is not available for this appointment right now.",
          };
        }

        const doctorName = appt.availability.doctor.user.name || "Doctor";
        const confirmation = await createPendingConfirmation({
          userId: ctx.userId,
          role: "PATIENT",
          action: "PATIENT_CHECK_IN",
          payload: { appointmentId: appt.id },
          title: "Confirm Clinic Check-In",
          summary: `Check in for Dr. ${doctorName}`,
          details: [
            {
              label: "Date & Time",
              value: `${formatDateIST(window.start)} • ${formatSlotTimeRangeIST(window.start, window.end)}`,
            },
          ],
          confirmLabel: "Confirm Check-In",
        });

        return { ok: true, requiresConfirmation: true, confirmation };
      },
    }),
  };
}
