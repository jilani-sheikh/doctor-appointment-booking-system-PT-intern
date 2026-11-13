"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  Role,
  DoctorStatus,
  SlotStatus,
  AppointmentStatus,
  AvailabilityKind,
  RescheduleLifecycleStatus,
  RefundStatus,
  NotificationType,
  Prisma,
} from "@/generated/prisma/client";
import { canPatientReschedule } from "@/lib/appointment-status";
import { releaseSlot, notifyWaitlistAfterSlotRelease } from "@/lib/slots";
import { createNotification } from "@/lib/notifications";
import { formatSlotDateTimeRangeIST, getISTDateString, getISTDayRangeUTC } from "@/lib/time";
import {
  rescheduleAppointmentSchema,
  waitlistEntrySchema,
  type RescheduleAppointmentInput,
  type WaitlistEntryInput,
} from "@/lib/validations/reschedule";
import { enqueuePatientNotifications } from "@/lib/notifications/index";
import { syncAppointmentReminders } from "@/lib/notifications/reminders";
import { getPaymentsMode } from "@/lib/env";
import { revalidatePath } from "next/cache";
import {
  effectiveSlot,
  isCrossDoctorPaymentCompatible,
  selectThreeLevelAlternatives,
  type ThreeLevelAlternativeSuggestions,
} from "@/lib/scheduling";

const ACTIVE_CONFLICT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_CONSULTATION,
];

/**
 * Discovers three-level alternative appointments for an affected patient:
 * Priority 1: Remaining compatible slots on the same day with the same doctor.
 * Priority 2: Other upcoming dates with the same doctor.
 * Priority 3: Other approved doctors in the same clinic/specialization (queried only when
 *             Priority 1 + Priority 2 return fewer than maxPerCategory suggestions and
 *             cross-doctor payment compatibility is satisfied).
 */
export async function discoverAlternativeAppointmentsForPatient(
  appointmentId: string,
  now: Date = new Date()
): Promise<ThreeLevelAlternativeSuggestions> {
  const empty: ThreeLevelAlternativeSuggestions = {
    sameDayAlternatives: [],
    upcomingDateAlternatives: [],
    otherDoctorAlternatives: [],
  };

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: {
        include: {
          doctor: {
            include: { user: { select: { name: true } } },
          },
        },
      },
      payments: {
        select: {
          status: true,
          amount: true,
          needsAttention: true,
        },
      },
      refunds: {
        where: { status: { not: RefundStatus.FAILED } },
        select: { id: true },
      },
    },
  });

  if (!appointment) return empty;

  const originalSlot = effectiveSlot(appointment);
  const originalDoctor = appointment.availability.doctor;
  const originalFeeRupees = Number(originalDoctor.consultationFee);
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const searchEnd = new Date(
    Math.max(originalSlot.start.getTime(), now.getTime()) + 30 * 24 * 60 * 60 * 1000
  );
  const maxPerCategory = 3;

  // Stage 1: Query only same-doctor candidate slots, patient active appointments, and same-doctor time-offs
  const [sameDoctorRows, patientOtherAppointments, sameDoctorTimeOffs] = await Promise.all([
    db.availability.findMany({
      where: {
        doctorId: originalDoctor.id,
        id: { not: appointment.availabilityId },
        status: SlotStatus.AVAILABLE,
        kind: { not: AvailabilityKind.WAVE_PARENT },
        blockedByTimeOffId: null,
        startTime: { gt: oneHourFromNow, lte: searchEnd },
      },
      include: {
        doctor: {
          include: { user: { select: { name: true } } },
        },
        parent: {
          select: { startTime: true, endTime: true, status: true },
        },
      },
      orderBy: { startTime: "asc" },
    }),
    db.appointment.findMany({
      where: {
        patientId: appointment.patientId,
        id: { not: appointment.id },
        status: { in: ACTIVE_CONFLICT_STATUSES },
      },
      include: {
        availability: {
          select: { id: true, doctorId: true, startTime: true, endTime: true },
        },
      },
    }),
    db.doctorTimeOff.findMany({
      where: {
        doctorId: originalDoctor.id,
        endAt: { gt: oneHourFromNow },
      },
      select: { doctorId: true, startAt: true, endAt: true },
    }),
  ]);

  const originalKind =
    appointment.availability.kind === AvailabilityKind.STREAM_WINDOW
      ? "STREAM_WINDOW"
      : appointment.availability.kind === AvailabilityKind.WAVE_SLOT
      ? "WAVE_SLOT"
      : "SINGLE";

  const mapRowToCandidate = (row: (typeof sameDoctorRows)[number]) => ({
    id: row.id,
    doctorId: row.doctorId,
    doctorName: row.doctor.user.name ?? "Practitioner",
    specialization: row.doctor.specialization,
    consultationFeeRupees: Number(row.doctor.consultationFee),
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    kind: row.kind,
    capacity: row.capacity,
    activeCount: row.activeCount,
    parentStartTime: row.parent?.startTime ?? null,
    parentEndTime: row.parent?.endTime ?? null,
    parentStatus: row.parent?.status ?? null,
    blockedByTimeOffId: row.blockedByTimeOffId,
  });

  const patientActiveSlots = patientOtherAppointments.map((appt) => {
    const eff = effectiveSlot(appt);
    return {
      availabilityId: appt.availabilityId,
      doctorId: appt.availability.doctorId,
      startTime: eff.start,
      endTime: eff.end,
    };
  });

  const sameDoctorSelection = selectThreeLevelAlternatives({
    originalAppointment: {
      availabilityId: appointment.availabilityId,
      doctorId: originalDoctor.id,
      specialization: originalDoctor.specialization,
      startTime: originalSlot.start,
      endTime: originalSlot.end,
      kind: originalKind,
      consultationFeeRupees: originalFeeRupees,
    },
    candidates: sameDoctorRows.map(mapRowToCandidate),
    timeOffs: sameDoctorTimeOffs,
    patientActiveSlots,
    minStartTime: oneHourFromNow,
    maxPerCategory,
    allowOtherClinicDoctors: false,
  });

  const sameDoctorSuggestionCount =
    sameDoctorSelection.sameDayAlternatives.length +
    sameDoctorSelection.upcomingDateAlternatives.length;

  // Avoid querying other doctors when Priority 1 + Priority 2 already provide >= maxPerCategory suggestions
  if (sameDoctorSuggestionCount >= maxPerCategory) {
    return sameDoctorSelection;
  }

  // Verify whether this appointment is payment-compatible with moving to another doctor of the same fee
  const paymentsMode = getPaymentsMode();
  const paymentSnapshot = appointment.payments.map((p) => ({
    status: p.status,
    amountRupees: Number(p.amount),
    needsAttention: p.needsAttention,
  }));
  const canMoveToSameFeeDoctor = isCrossDoctorPaymentCompatible({
    originalDoctorFeeRupees: originalFeeRupees,
    targetDoctorFeeRupees: originalFeeRupees,
    payments: paymentSnapshot,
    refundCount: appointment.refunds.length,
    paymentsMode,
  });

  if (!canMoveToSameFeeDoctor) {
    return sameDoctorSelection;
  }

  // Stage 2: Query other approved clinic doctors of the same specialization & fee only when needed
  const otherDoctorRows = await db.availability.findMany({
    where: {
      doctorId: { not: originalDoctor.id },
      id: { not: appointment.availabilityId },
      status: SlotStatus.AVAILABLE,
      kind: { not: AvailabilityKind.WAVE_PARENT },
      blockedByTimeOffId: null,
      startTime: { gt: oneHourFromNow, lte: searchEnd },
      doctor: {
        status: DoctorStatus.APPROVED,
        specialization: { equals: originalDoctor.specialization, mode: "insensitive" },
        consultationFee: originalDoctor.consultationFee,
      },
    },
    include: {
      doctor: {
        include: { user: { select: { name: true } } },
      },
      parent: {
        select: { startTime: true, endTime: true, status: true },
      },
    },
    orderBy: { startTime: "asc" },
  });

  if (otherDoctorRows.length === 0) {
    return sameDoctorSelection;
  }

  const otherDoctorIds = [...new Set(otherDoctorRows.map((r) => r.doctorId))];
  const otherDoctorTimeOffs = await db.doctorTimeOff.findMany({
    where: {
      doctorId: { in: otherDoctorIds },
      endAt: { gt: oneHourFromNow },
    },
    select: { doctorId: true, startAt: true, endAt: true },
  });

  const compatibleOtherRows = otherDoctorRows.filter((row) =>
    isCrossDoctorPaymentCompatible({
      originalDoctorFeeRupees: originalFeeRupees,
      targetDoctorFeeRupees: Number(row.doctor.consultationFee),
      payments: paymentSnapshot,
      refundCount: appointment.refunds.length,
      paymentsMode,
    })
  );

  return selectThreeLevelAlternatives({
    originalAppointment: {
      availabilityId: appointment.availabilityId,
      doctorId: originalDoctor.id,
      specialization: originalDoctor.specialization,
      startTime: originalSlot.start,
      endTime: originalSlot.end,
      kind: originalKind,
      consultationFeeRupees: originalFeeRupees,
    },
    candidates: [...sameDoctorRows, ...compatibleOtherRows].map(mapRowToCandidate),
    timeOffs: [...sameDoctorTimeOffs, ...otherDoctorTimeOffs],
    patientActiveSlots,
    minStartTime: oneHourFromNow,
    maxPerCategory,
    allowOtherClinicDoctors: true,
  });
}

/**
 * Reschedules an appointment to a new available slot.
 *
 * Transaction Safety:
 * In a single short interactive transaction:
 * (a) Revalidates ownership, status, kind compatibility, cross-doctor payment compatibility, capacity, time-off, shrunk parent bounds, and patient conflicts
 * (b) Atomically claims capacity on the new slot (active_count + 1 where active_count < capacity and status = AVAILABLE)
 * (c) Updates existing appointment, preserves CONFIRMED status, clears disruption fields, sets rescheduleStatus = RESCHEDULED
 * (d) Releases old slot using shared releaseSlot helper (which keeps shrunk Wave slots BLOCKED)
 * Post-commit:
 * Dispatches notifications to doctor(s), patient, and waitlist for the freed slot.
 */
export async function patientRescheduleAppointmentAction(input: RescheduleAppointmentInput) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    return { success: false, error: "Patient profile not found." };
  }

  const parsed = rescheduleAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid parameters." };
  }

  const { appointmentId, newAvailabilityId } = parsed.data;
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const paymentsMode = getPaymentsMode();

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: {
        include: {
          doctor: {
            include: { user: { select: { name: true, id: true } } },
          },
        },
      },
      payments: {
        select: {
          status: true,
          amount: true,
          needsAttention: true,
        },
      },
      refunds: {
        where: { status: { not: RefundStatus.FAILED } },
        select: { id: true },
      },
    },
  });

  if (!appointment || appointment.patientId !== user.patient.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }
  const oldAppointmentSlot = effectiveSlot(appointment);

  const rescheduleEval = canPatientReschedule(
    {
      status: appointment.status,
      startTime: oldAppointmentSlot.start,
      rescheduleCount: appointment.rescheduleCount,
      disruptedAt: appointment.disruptedAt,
    },
    now
  );

  if (!rescheduleEval.allowed) {
    return { success: false, error: rescheduleEval.reason ?? "Reschedule not allowed." };
  }

  const oldAvailabilityId = appointment.availabilityId;
  const originalDoctorId = appointment.availability.doctorId;
  const isDisrupted =
    Boolean(appointment.disruptedAt) ||
    appointment.rescheduleStatus === RescheduleLifecycleStatus.PENDING_RESCHEDULING;

  if (newAvailabilityId === oldAvailabilityId) {
    return { success: false, error: "Please select a different consultation slot." };
  }

  // Pre-verify new slot
  const newSlot = await db.availability.findUnique({
    where: { id: newAvailabilityId },
    include: {
      doctor: {
        include: { user: { select: { name: true, id: true } } },
      },
      parent: {
        select: { startTime: true, endTime: true, status: true },
      },
    },
  });

  if (!newSlot || newSlot.kind === AvailabilityKind.WAVE_PARENT) {
    return { success: false, error: "The selected slot is not available." };
  }

  if (newSlot.doctorId !== originalDoctorId) {
    const paymentCompatible = isCrossDoctorPaymentCompatible({
      originalDoctorFeeRupees: Number(appointment.availability.doctor.consultationFee),
      targetDoctorFeeRupees: Number(newSlot.doctor.consultationFee),
      payments: appointment.payments.map((p) => ({
        status: p.status,
        amountRupees: Number(p.amount),
        needsAttention: p.needsAttention,
      })),
      refundCount: appointment.refunds.length,
      paymentsMode,
    });

    const canCrossDoctorReschedule =
      isDisrupted &&
      newSlot.doctor.status === DoctorStatus.APPROVED &&
      newSlot.doctor.specialization.toLowerCase() ===
        appointment.availability.doctor.specialization.toLowerCase() &&
      paymentCompatible;

    if (!canCrossDoctorReschedule) {
      return {
        success: false,
        error: "The selected slot is not compatible with your current booking or payment record.",
      };
    }
  }

  // Enforce Wave vs. Stream scheduling-type compatibility
  if (appointment.availability.kind === AvailabilityKind.STREAM_WINDOW) {
    if (newSlot.kind !== AvailabilityKind.STREAM_WINDOW) {
      return {
        success: false,
        error: "Stream consultations can only be rescheduled to a compatible Stream availability window.",
      };
    }
  } else if (newSlot.kind === AvailabilityKind.STREAM_WINDOW) {
    return {
      success: false,
      error: "Slot-based consultations cannot be rescheduled into a continuous Stream window.",
    };
  }

  if (
    newSlot.status !== SlotStatus.AVAILABLE ||
    newSlot.activeCount >= newSlot.capacity ||
    newSlot.blockedByTimeOffId != null ||
    newSlot.startTime <= oneHourFromNow
  ) {
    return { success: false, error: "The selected slot is not available or starts within 1 hour." };
  }

  if (
    newSlot.kind === AvailabilityKind.WAVE_SLOT &&
    newSlot.parent &&
    (newSlot.startTime < newSlot.parent.startTime ||
      newSlot.endTime > newSlot.parent.endTime ||
      newSlot.parent.status === SlotStatus.BLOCKED)
  ) {
    return { success: false, error: "The selected slot is outside the active availability window." };
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        // 1. Revalidate target slot and appointment inside transaction (ownership, cross-doctor payment compatibility, time-off, shrunk parent bounds, patient conflicts)
        const [currentAppt, currentNewSlot] = await Promise.all([
          tx.appointment.findUnique({
            where: { id: appointmentId },
            include: {
              availability: {
                include: {
                  doctor: {
                    select: {
                      id: true,
                      specialization: true,
                      consultationFee: true,
                    },
                  },
                },
              },
              payments: {
                select: {
                  status: true,
                  amount: true,
                  needsAttention: true,
                },
              },
              refunds: {
                where: { status: { not: RefundStatus.FAILED } },
                select: { id: true },
              },
            },
          }),
          tx.availability.findUnique({
            where: { id: newAvailabilityId },
            include: {
              doctor: {
                select: {
                  id: true,
                  status: true,
                  specialization: true,
                  consultationFee: true,
                },
              },
              parent: { select: { startTime: true, endTime: true, status: true } },
            },
          }),
        ]);

        if (
          !currentAppt ||
          currentAppt.patientId !== user.patient!.id ||
          currentAppt.availabilityId !== oldAvailabilityId ||
          (currentAppt.status !== AppointmentStatus.PENDING &&
            currentAppt.status !== AppointmentStatus.CONFIRMED)
        ) {
          throw new Error("APPOINTMENT_CONFLICT");
        }

        if (
          !currentNewSlot ||
          currentNewSlot.status !== SlotStatus.AVAILABLE ||
          currentNewSlot.activeCount >= currentNewSlot.capacity ||
          currentNewSlot.blockedByTimeOffId != null ||
          currentNewSlot.startTime <= oneHourFromNow
        ) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        if (currentNewSlot.doctorId !== currentAppt.availability.doctorId) {
          const currentlyDisrupted =
            Boolean(currentAppt.disruptedAt) ||
            currentAppt.rescheduleStatus === RescheduleLifecycleStatus.PENDING_RESCHEDULING;
          const txPaymentCompatible = isCrossDoctorPaymentCompatible({
            originalDoctorFeeRupees: Number(currentAppt.availability.doctor.consultationFee),
            targetDoctorFeeRupees: Number(currentNewSlot.doctor.consultationFee),
            payments: currentAppt.payments.map((p) => ({
              status: p.status,
              amountRupees: Number(p.amount),
              needsAttention: p.needsAttention,
            })),
            refundCount: currentAppt.refunds.length,
            paymentsMode,
          });

          if (
            !currentlyDisrupted ||
            currentNewSlot.doctor.status !== DoctorStatus.APPROVED ||
            currentNewSlot.doctor.specialization.toLowerCase() !==
              currentAppt.availability.doctor.specialization.toLowerCase() ||
            !txPaymentCompatible
          ) {
            throw new Error("SLOT_UNAVAILABLE");
          }
        }

        if (
          currentNewSlot.kind === AvailabilityKind.WAVE_SLOT &&
          currentNewSlot.parent &&
          (currentNewSlot.startTime < currentNewSlot.parent.startTime ||
            currentNewSlot.endTime > currentNewSlot.parent.endTime ||
            currentNewSlot.parent.status === SlotStatus.BLOCKED)
        ) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        const timeOff = await tx.doctorTimeOff.findFirst({
          where: {
            doctorId: currentNewSlot.doctorId,
            startAt: { lt: currentNewSlot.endTime },
            endAt: { gt: currentNewSlot.startTime },
          },
          select: { id: true },
        });
        if (timeOff) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        const targetDateIST = getISTDateString(currentNewSlot.startTime);
        const { start: dayStart, end: dayEnd } = getISTDayRangeUTC(targetDateIST);
        const patientConflict = await tx.appointment.findFirst({
          where: {
            patientId: user.patient!.id,
            id: { not: appointmentId },
            status: { in: ACTIVE_CONFLICT_STATUSES },
            OR: [
              {
                availability: {
                  startTime: { lt: currentNewSlot.endTime },
                  endTime: { gt: currentNewSlot.startTime },
                },
              },
              {
                availability: {
                  doctorId: currentNewSlot.doctorId,
                  startTime: { gte: dayStart, lte: dayEnd },
                },
              },
            ],
          },
          select: { id: true },
        });
        if (patientConflict) {
          throw new Error("PATIENT_CONFLICT");
        }

        // 2. Atomically claim seat on the new slot using conditional capacity check
        const bookNew = await tx.$executeRaw`
          UPDATE "availabilities"
          SET "active_count" = "active_count" + 1,
              "status" = CASE WHEN "active_count" + 1 >= "capacity" THEN 'BOOKED'::"SlotStatus" ELSE "status" END
          WHERE "id" = ${newAvailabilityId}
            AND "status" = 'AVAILABLE'::"SlotStatus"
            AND "active_count" < "capacity"
            AND "blocked_by_time_off_id" IS NULL
            AND "start_time" > ${oneHourFromNow}
        `;

        if (bookNew !== 1) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        // 3. Conditionally update existing appointment (guards against duplicate submissions)
        const updatedAppt = await tx.appointment.updateMany({
          where: {
            id: appointmentId,
            patientId: user.patient!.id,
            availabilityId: oldAvailabilityId,
            status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
          },
          data: {
            availabilityId: newAvailabilityId,
            rescheduledFromAvailabilityId: oldAvailabilityId,
            rescheduleCount: { increment: 1 },
            status: AppointmentStatus.CONFIRMED,
            waveId: null,
            slotStart: null,
            slotEnd: null,
            disruptedAt: null,
            disruptionReason: null,
            rescheduleStatus: RescheduleLifecycleStatus.RESCHEDULED,
          },
        });

        if (updatedAppt.count !== 1) {
          throw new Error("APPOINTMENT_CONFLICT");
        }

        // 4. Free the old slot using shared releaseSlot helper (keeps shrunk Wave slots BLOCKED)
        const oldRelease = await releaseSlot(tx, oldAvailabilityId);

        // 5. Synchronize reminders for new slot time
        await syncAppointmentReminders(tx, {
          appointmentId,
          userId: user.id,
          slotStartTime: currentNewSlot.startTime,
          slotEndTime: currentNewSlot.endTime,
          status: AppointmentStatus.CONFIRMED,
        });

        return { oldRelease };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // Post-commit: trigger notifications
    const newSlotTimeFormatted = formatSlotDateTimeRangeIST(newSlot.startTime, newSlot.endTime);
    const doctorName = newSlot.doctor.user.name ?? "Practitioner";

    // Notify patient
    await createNotification({
      userId: user.id,
      type: NotificationType.APPOINTMENT_RESCHEDULED,
      title: "Appointment Rescheduled",
      body: `Your consultation with Dr. ${doctorName} has been rescheduled to ${newSlotTimeFormatted}.`,
      href: "/patient/appointments",
    });

    // Enqueue outbox email
    await enqueuePatientNotifications(db, {
      userId: user.id,
      appointmentId,
      template: "appointment_rescheduled",
      payload: {
        doctorName,
        oldStartTime: oldAppointmentSlot.start.toISOString(),
        oldEndTime: oldAppointmentSlot.end.toISOString(),
        newStartTime: newSlot.startTime.toISOString(),
        newEndTime: newSlot.endTime.toISOString(),
      },
      dedupeKey: `email:rescheduled:${appointmentId}:${newSlot.startTime.getTime()}`,
    });

    // Notify target doctor
    await createNotification({
      userId: newSlot.doctor.user.id,
      type: NotificationType.APPOINTMENT_RESCHEDULED,
      title: "Patient Rescheduled Consultation",
      body: `${user.name ?? "A patient"} has rescheduled their consultation to ${newSlotTimeFormatted}.`,
      href: "/doctor/appointments",
    });

    // If rescheduled across doctors, also notify the original doctor that the disrupted appointment was moved
    if (newSlot.doctorId !== originalDoctorId) {
      await createNotification({
        userId: appointment.availability.doctor.user.id,
        type: NotificationType.APPOINTMENT_RESCHEDULED,
        title: "Disrupted Consultation Rescheduled",
        body: `${user.name ?? "A patient"} rescheduled their disrupted consultation to Dr. ${doctorName} (${newSlotTimeFormatted}).`,
        href: "/doctor/appointments",
      });
    }

    // Notify waitlist if old slot is newly available
    if (result.oldRelease.newlyAvailable) {
      await notifyWaitlistAfterSlotRelease(originalDoctorId, result.oldRelease.startTime);
    }

    revalidatePath(`/book/reschedule/${appointmentId}`);
    revalidatePath("/patient/appointments");
    revalidatePath("/patient/dashboard");
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/dashboard");
    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/slots");
    revalidatePath("/doctor/arrival-windows");
    revalidatePath(`/doctors/${originalDoctorId}`);
    if (newSlot.doctorId !== originalDoctorId) {
      revalidatePath(`/doctors/${newSlot.doctorId}`);
    }

    return {
      success: true,
      message: `Appointment successfully rescheduled to ${newSlotTimeFormatted}!`,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_UNAVAILABLE") {
      return {
        success: false,
        staleSlot: true,
        error: "The chosen slot was just taken or is no longer available. Please choose another from the refreshed options.",
      };
    }
    if (error instanceof Error && error.message === "PATIENT_CONFLICT") {
      return {
        success: false,
        error: "You already have an active consultation at that time or with this doctor on that date.",
      };
    }
    if (error instanceof Error && error.message === "APPOINTMENT_CONFLICT") {
      return {
        success: false,
        error: "This appointment was already updated. Please refresh the page.",
      };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, staleSlot: true, error: "The chosen slot is no longer available." };
    }
    console.error("[patientRescheduleAppointmentAction] Error:", error);
    return { success: false, error: "Failed to reschedule appointment. Please try again." };
  }
}

/**
 * Doctor reschedule action with a reason.
 */
export async function doctorRescheduleAppointmentAction(input: RescheduleAppointmentInput) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can reschedule consultations." };
  }

  const parsed = rescheduleAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid parameters." };
  }

  const { appointmentId, newAvailabilityId, reason } = parsed.data;

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: true,
      patient: { select: { userId: true, user: { select: { name: true } } } },
    },
  });

  if (!appointment || appointment.availability.doctorId !== doctor.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  const oldAvailabilityId = appointment.availabilityId;
  const oldAppointmentSlot = effectiveSlot(appointment);

  // New slot check
  const newSlot = await db.availability.findUnique({
    where: { id: newAvailabilityId },
    include: {
      parent: { select: { startTime: true, endTime: true, status: true } },
    },
  });

  if (
    !newSlot ||
    newSlot.doctorId !== doctor.id ||
    newSlot.kind === AvailabilityKind.WAVE_PARENT ||
    newSlot.status !== SlotStatus.AVAILABLE ||
    newSlot.activeCount >= newSlot.capacity ||
    newSlot.blockedByTimeOffId != null
  ) {
    return { success: false, error: "The selected slot is not available." };
  }

  if (appointment.availability.kind === AvailabilityKind.STREAM_WINDOW) {
    if (newSlot.kind !== AvailabilityKind.STREAM_WINDOW) {
      return {
        success: false,
        error: "Stream consultations can only be rescheduled to a compatible Stream availability window.",
      };
    }
  } else if (newSlot.kind === AvailabilityKind.STREAM_WINDOW) {
    return {
      success: false,
      error: "Slot-based consultations cannot be rescheduled into a continuous Stream window.",
    };
  }

  if (
    newSlot.kind === AvailabilityKind.WAVE_SLOT &&
    newSlot.parent &&
    (newSlot.startTime < newSlot.parent.startTime ||
      newSlot.endTime > newSlot.parent.endTime ||
      newSlot.parent.status === SlotStatus.BLOCKED)
  ) {
    return { success: false, error: "The selected slot is outside the active availability window." };
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        const bookNew = await tx.$executeRaw`
          UPDATE "availabilities"
          SET "active_count" = "active_count" + 1,
              "status" = CASE WHEN "active_count" + 1 >= "capacity" THEN 'BOOKED'::"SlotStatus" ELSE "status" END
          WHERE "id" = ${newAvailabilityId}
            AND "doctor_id" = ${doctor.id}
            AND "status" = 'AVAILABLE'::"SlotStatus"
            AND "active_count" < "capacity"
            AND "blocked_by_time_off_id" IS NULL
        `;

        if (bookNew !== 1) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            availabilityId: newAvailabilityId,
            rescheduledFromAvailabilityId: oldAvailabilityId,
            rescheduleCount: { increment: 1 },
            waveId: null,
            slotStart: null,
            slotEnd: null,
            disruptedAt: null,
            disruptionReason: null,
            rescheduleStatus: RescheduleLifecycleStatus.RESOLVED_MANUALLY,
            status: AppointmentStatus.CONFIRMED, // Confirmed by doctor
          },
        });

        const oldRelease = await releaseSlot(tx, oldAvailabilityId);

        await syncAppointmentReminders(tx, {
          appointmentId,
          userId: appointment.patient.userId,
          slotStartTime: newSlot.startTime,
          slotEndTime: newSlot.endTime,
          status: AppointmentStatus.CONFIRMED,
        });

        return { oldRelease };
      },
      { maxWait: 10000, timeout: 20000 }
    );

    const newSlotTimeFormatted = formatSlotDateTimeRangeIST(newSlot.startTime, newSlot.endTime);
    const doctorName = user.name ?? "Practitioner";

    // Notify patient
    await createNotification({
      userId: appointment.patient.userId,
      type: NotificationType.APPOINTMENT_RESCHEDULED,
      title: "Doctor Rescheduled Your Consultation",
      body: `Dr. ${doctorName} has rescheduled your consultation to ${newSlotTimeFormatted}.${
        reason ? ` Reason: ${reason}` : ""
      }`,
      href: "/patient/appointments",
    });

    await enqueuePatientNotifications(db, {
      userId: appointment.patient.userId,
      appointmentId,
      template: "appointment_rescheduled",
      payload: {
        doctorName,
        oldStartTime: oldAppointmentSlot.start.toISOString(),
        oldEndTime: oldAppointmentSlot.end.toISOString(),
        newStartTime: newSlot.startTime.toISOString(),
        newEndTime: newSlot.endTime.toISOString(),
      },
      dedupeKey: `email:doctor_rescheduled:${appointmentId}:${newSlot.startTime.getTime()}`,
    });

    if (result.oldRelease.newlyAvailable) {
      await notifyWaitlistAfterSlotRelease(doctor.id, result.oldRelease.startTime);
    }

    revalidatePath(`/book/reschedule/${appointmentId}`);
    revalidatePath("/doctor/appointments");
    revalidatePath("/doctor/queue");
    revalidatePath("/doctor/slots");
    revalidatePath("/patient/appointments");
    revalidatePath(`/doctors/${doctor.id}`);

    return {
      success: true,
      message: `Appointment rescheduled to ${newSlotTimeFormatted}. Patient notified.`,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_UNAVAILABLE") {
      return { success: false, error: "The selected slot is no longer available." };
    }
    console.error("[doctorRescheduleAppointmentAction] Error:", error);
    return { success: false, error: "Failed to reschedule appointment." };
  }
}

/**
 * Marks a disrupted appointment (e.g. from an elastic shrink) as RESOLVED_MANUALLY
 * once the doctor/clinic has manually resolved or accommodated the consultation.
 */
export async function resolveDisruptedAppointmentManuallyAction(
  appointmentId: string,
  resolutionNote?: string
) {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return { success: false, error: "Only approved doctors can resolve disrupted consultations." };
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      availability: true,
      patient: { select: { userId: true } },
    },
  });

  if (!appointment || appointment.availability.doctorId !== doctor.id) {
    return { success: false, error: "Appointment not found or unauthorized." };
  }

  await db.appointment.update({
    where: { id: appointmentId },
    data: {
      disruptedAt: null,
      disruptionReason: null,
      rescheduleStatus: RescheduleLifecycleStatus.RESOLVED_MANUALLY,
    },
  });

  const slotRange = formatSlotDateTimeRangeIST(
    effectiveSlot(appointment).start,
    effectiveSlot(appointment).end
  );
  const doctorName = user.name ?? "Practitioner";

  await createNotification({
    userId: appointment.patient.userId,
    type: NotificationType.APPOINTMENT_CONFIRMED,
    title: "Consultation Schedule Confirmed",
    body: `Dr. ${doctorName} has resolved the schedule adjustment for your consultation (${slotRange} IST).${
      resolutionNote ? ` Note: ${resolutionNote}` : ""
    }`,
    href: "/patient/appointments",
  });

  revalidatePath(`/book/reschedule/${appointmentId}`);
  revalidatePath("/doctor/appointments");
  revalidatePath("/patient/appointments");

  return {
    success: true,
    message: "Appointment marked as resolved manually.",
  };
}

/**
 * Adds patient to doctor's waitlist for newly available slots.
 */
export async function joinWaitlistAction(input: WaitlistEntryInput) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    return { success: false, error: "Please complete patient onboarding first." };
  }

  const parsed = waitlistEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid parameters." };
  }

  const { doctorId, earliestDate, latestDate } = parsed.data;

  try {
    await db.waitlistEntry.upsert({
      where: {
        patientId_doctorId: {
          patientId: user.patient.id,
          doctorId,
        },
      },
      update: {
        earliestDate: new Date(earliestDate),
        latestDate: new Date(latestDate),
        notifiedAt: null, // Reset notification status
      },
      create: {
        patientId: user.patient.id,
        doctorId,
        earliestDate: new Date(earliestDate),
        latestDate: new Date(latestDate),
      },
    });

    revalidatePath(`/doctors/${doctorId}`);

    return {
      success: true,
      message: "You have joined the waitlist! We will notify you when a consultation slot opens up.",
    };
  } catch (error) {
    console.error("[joinWaitlistAction] Error:", error);
    return { success: false, error: "Failed to join waitlist. Please try again." };
  }
}

/**
 * Removes patient from doctor's waitlist.
 */
export async function leaveWaitlistAction(doctorId: string) {
  const user = await requireRole(Role.PATIENT);
  if (!user.patient) {
    return { success: false, error: "Patient profile not found." };
  }

  try {
    await db.waitlistEntry.deleteMany({
      where: {
        patientId: user.patient.id,
        doctorId,
      },
    });

    revalidatePath(`/doctors/${doctorId}`);

    return { success: true, message: "You have been removed from the waitlist." };
  } catch (error) {
    console.error("[leaveWaitlistAction] Error:", error);
    return { success: false, error: "Failed to remove from waitlist." };
  }
}
