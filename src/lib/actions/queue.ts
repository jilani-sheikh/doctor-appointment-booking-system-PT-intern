"use server";

import { requireRole, requireUser } from "@/lib/auth";
import { markAppointmentArrived } from "@/lib/check-in";
import { db } from "@/lib/db";
import {
  Role,
  AppointmentStatus,
  NotificationType,
  Prisma,
} from "@/generated/prisma/client";
import {
  checkAndNotifyQueueDelay,
  createNotification,
} from "@/lib/notifications";
import { syncAppointmentReminders } from "@/lib/notifications/reminders";
import {
  executeCallNextPatient,
  executeMarkCompleted,
  executeMarkNotArrived,
  executeStartConsultation,
  type StaffOutcomeTxAdapter,
} from "@/lib/queue-actions-core";
import { formatDoctorDisplayName } from "@/lib/queue-tokens";
import { effectiveSlot } from "@/lib/scheduling";
import { revalidatePath } from "next/cache";

function revalidateAllQueuePortals() {
  revalidatePath("/receptionist");
  revalidatePath("/doctor/queue");
  revalidatePath("/doctor/appointments");
  revalidatePath("/doctor/dashboard");
  revalidatePath("/patient/appointments");
  revalidatePath("/patient/dashboard");
  revalidatePath("/notifications");
}

function buildPrismaStaffOutcomeAdapter(
  tx: Prisma.TransactionClient
): StaffOutcomeTxAdapter {
  return {
    async lockDoctor(doctorId) {
      await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctorId} FOR UPDATE`;
    },
    async findAppointment(appointmentId) {
      const appt = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          availability: true,
          patient: { select: { userId: true } },
        },
      });
      if (!appt) return null;
      return {
        id: appt.id,
        doctorId: appt.availability.doctorId,
        availabilityId: appt.availabilityId,
        patientUserId: appt.patient.userId,
        status: appt.status,
        slotStartTime: effectiveSlot(appt).start,
        actualStartAt: appt.actualStartAt,
        actualEndAt: appt.actualEndAt,
      };
    },
    async findActiveInConsultationOnDay({
      doctorId,
      dayStart,
      nextDayStart,
      excludeAppointmentId,
    }) {
      return await tx.appointment.findFirst({
        where: {
          id: { not: excludeAppointmentId },
          availability: {
            doctorId,
            startTime: { gte: dayStart, lt: nextDayStart },
          },
          status: AppointmentStatus.IN_CONSULTATION,
        },
        select: { id: true },
      });
    },
    async conditionalStartConsultation({ appointmentId, actualStartAt }) {
      const res = await tx.appointment.updateMany({
        where: {
          id: appointmentId,
          status: AppointmentStatus.CALLED,
        },
        data: {
          status: AppointmentStatus.IN_CONSULTATION,
          actualStartAt,
        },
      });
      return res.count;
    },
    async conditionalMarkNoShow({ appointmentId, noShowAt, noShowByUserId }) {
      const res = await tx.appointment.updateMany({
        where: {
          id: appointmentId,
          status: {
            in: [
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.CALLED,
            ],
          },
        },
        data: {
          status: AppointmentStatus.NO_SHOW,
          noShowAt,
          noShowByUserId,
        },
      });
      return res.count;
    },
    async conditionalMarkCompleted({
      appointmentId,
      completedAt,
      completedByUserId,
      actualStartAt,
      actualEndAt,
    }) {
      const res = await tx.appointment.updateMany({
        where: {
          id: appointmentId,
          status: AppointmentStatus.IN_CONSULTATION,
        },
        data: {
          status: AppointmentStatus.COMPLETED,
          completedAt,
          completedByUserId,
          actualStartAt,
          actualEndAt,
        },
      });
      return res.count;
    },
    async syncReminders({ appointmentId, userId, slotStartTime, status }) {
      await syncAppointmentReminders(tx, {
        appointmentId,
        userId,
        slotStartTime,
        status,
      });
    },
  };
}

export interface ReceptionistQueueScopeContext {
  expectedDoctorId?: string;
  expectedAvailabilityId?: string;
}

/**
 * Patient self-check-in for their own confirmed appointment.
 * Delegates to the shared atomic check-in service (preserving the strict 30m window).
 */
export async function patientCheckInAction(appointmentId: string) {
  const user = await requireRole(Role.PATIENT);
  const res = await markAppointmentArrived({ appointmentId, actor: user });
  if (res.success) {
    revalidateAllQueuePortals();
  }
  return res;
}

/**
 * Receptionist Check-In action reusing the shared atomic check-in service.
 */
export async function receptionistMarkArrivedAction(
  appointmentId: string,
  context?: ReceptionistQueueScopeContext
) {
  const user = await requireRole(Role.RECEPTIONIST);
  const res = await markAppointmentArrived({
    appointmentId,
    actor: user,
    expectedDoctorId: context?.expectedDoctorId,
    expectedAvailabilityId: context?.expectedAvailabilityId,
  });
  if (res.success) {
    revalidateAllQueuePortals();
  }
  return res;
}

/**
 * Receptionist action: Call Next Patient in a selected doctor's sub-slot queue.
 * - Requires explicit doctorId & availabilityId verified against DB ownership.
 * - Serializes via doctor row FOR UPDATE + conditional CHECKED_IN -> CALLED transition.
 * - Prevents duplicate concurrent calls or calling while another patient is CALLED / IN_CONSULTATION.
 * - Records calledAt + calledByUserId and notifies Patient + attending Doctor.
 */
export async function receptionistCallNextPatientAction(input: {
  doctorId: string;
  availabilityId: string;
  queueScopeKey?: string;
}) {
  const user = await requireRole(Role.RECEPTIONIST);

  const doctorId = input.doctorId?.trim() || "";
  const availabilityId = input.availabilityId?.trim() || "";

  if (!doctorId || !availabilityId) {
    return {
      success: false,
      error: "Please select a doctor and sub-slot queue before calling the next patient.",
    };
  }

  try {
    const txResult = await db.$transaction(
      async (tx) => {
        return await executeCallNextPatient({
          tx: {
            async findDoctor(docId) {
              const doc = await tx.doctor.findUnique({
                where: { id: docId },
                include: { user: { select: { name: true } } },
              });
              if (!doc) return null;
              return {
                id: doc.id,
                userId: doc.userId,
                status: doc.status,
                name: doc.user.name,
              };
            },
            async lockDoctor(docId) {
              await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${docId} FOR UPDATE`;
            },
            async findAvailability(availId) {
              return await tx.availability.findUnique({
                where: { id: availId },
                select: {
                  id: true,
                  doctorId: true,
                  kind: true,
                  startTime: true,
                  endTime: true,
                },
              });
            },
            async findActiveDoctorCallOnDay({ doctorId: docId, dayStart, nextDayStart }) {
              const active = await tx.appointment.findFirst({
                where: {
                  availability: {
                    doctorId: docId,
                    startTime: { gte: dayStart, lt: nextDayStart },
                  },
                  status: {
                    in: [
                      AppointmentStatus.CALLED,
                      AppointmentStatus.IN_CONSULTATION,
                    ],
                  },
                },
                include: {
                  patient: {
                    include: {
                      user: { select: { name: true } },
                    },
                  },
                },
              });
              if (!active) return null;
              return {
                id: active.id,
                status: active.status,
                tokenNumber: active.tokenNumber,
                patientName: active.patient.user.name,
              };
            },
            async findSubSlotCheckedInCandidates(availId) {
              const rows = await tx.appointment.findMany({
                where: {
                  availabilityId: availId,
                  status: AppointmentStatus.CHECKED_IN,
                },
                include: {
                  patient: {
                    include: {
                      user: { select: { id: true, name: true } },
                    },
                  },
                },
              });
              return rows.map((row) => ({
                id: row.id,
                status: row.status,
                tokenNumber: row.tokenNumber,
                checkedInAt: row.checkedInAt,
                createdAt: row.createdAt,
                actualStartAt: row.actualStartAt,
                slotStart: row.slotStart,
                slotEnd: row.slotEnd,
                patientUserId: row.patient.userId,
                patientName: row.patient.user.name,
              }));
            },
            async conditionalMarkCalled({
              appointmentId,
              calledAt,
              calledByUserId,
            }) {
              const updated = await tx.appointment.updateMany({
                where: {
                  id: appointmentId,
                  status: AppointmentStatus.CHECKED_IN,
                  availability: { id: availabilityId, doctorId },
                },
                data: {
                  status: AppointmentStatus.CALLED,
                  calledAt,
                  calledByUserId,
                },
              });
              return updated.count;
            },
            async syncReminders({ appointmentId, userId, slotStartTime, status }) {
              await syncAppointmentReminders(tx, {
                appointmentId,
                userId,
                slotStartTime,
                status,
              });
            },
          },
          actor: {
            id: user.id,
            role: Role.RECEPTIONIST,
          },
          doctorId,
          availabilityId,
          queueScopeKey: input.queueScopeKey,
        });
      },
      { maxWait: 10000, timeout: 20000 }
    );

    if (!txResult.success) {
      return { success: false, error: txResult.error };
    }

    // Best-effort post-commit notifications to Patient & attending Doctor
    try {
      const doctorLabel = formatDoctorDisplayName(txResult.doctorName);
      const tokenNote =
        typeof txResult.tokenNumber === "number"
          ? `Token #${txResult.tokenNumber}`
          : "Your turn";

      if (txResult.patientUserId) {
        await createNotification({
          userId: txResult.patientUserId,
          type: NotificationType.QUEUE_CALLED,
          title: `You are called — ${tokenNote}`,
          body: `Reception Desk called you for ${doctorLabel} (${txResult.subSlotLabel ?? "Scheduled Sub-slot"}). Please proceed to the consultation room.`,
          href: "/patient/appointments",
        });
      }

      if (txResult.doctorUserId && txResult.notification) {
        await createNotification({
          userId: txResult.doctorUserId,
          type: NotificationType.QUEUE_CALLED,
          title: txResult.notification.title,
          body: txResult.notification.body,
          href: "/doctor/queue",
        });
      }

      if (txResult.doctorId) {
        await checkAndNotifyQueueDelay(txResult.doctorId);
      }
    } catch (notifError) {
      console.error("[receptionistCallNextPatientAction] Post-commit notification error:", notifError);
    }

    revalidateAllQueuePortals();

    const tokenLabel =
      typeof txResult.tokenNumber === "number" ? `Token #${txResult.tokenNumber}` : "Next patient";
    return {
      success: true,
      appointmentId: txResult.appointmentId,
      tokenNumber: txResult.tokenNumber ?? null,
      message: `Called ${txResult.patientName ?? "Patient"} (${tokenLabel}) for ${formatDoctorDisplayName(txResult.doctorName)}.`,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      console.error("[receptionistCallNextPatientAction] Transaction timeout (P2028):", error);
      return { success: false, error: "The operation timed out. Please try again." };
    }
    console.error("[receptionistCallNextPatientAction] Error:", error);
    return { success: false, error: "Failed to call next patient." };
  }
}

/**
 * Receptionist action: Start Consultation (CALLED -> IN_CONSULTATION).
 * Stamps `actualStartAt` and triggers delay evaluation cleanly.
 */
export async function receptionistStartConsultationAction(
  appointmentId: string,
  context?: ReceptionistQueueScopeContext
) {
  const user = await requireRole(Role.RECEPTIONIST);

  try {
    const res = await db.$transaction(
      async (tx) =>
        await executeStartConsultation({
          tx: buildPrismaStaffOutcomeAdapter(tx),
          actor: { id: user.id, role: Role.RECEPTIONIST },
          appointmentId,
          expectedDoctorId: context?.expectedDoctorId,
          expectedAvailabilityId: context?.expectedAvailabilityId,
        }),
      { maxWait: 10000, timeout: 20000 }
    );

    if (!res.success) {
      return { success: false, error: res.error };
    }

    if (res.doctorId) {
      await checkAndNotifyQueueDelay(res.doctorId);
    }

    revalidateAllQueuePortals();
    return { success: true, message: "Consultation started." };
  } catch (error) {
    console.error("[receptionistStartConsultationAction] Error:", error);
    return { success: false, error: "Failed to start consultation." };
  }
}

/**
 * Receptionist action: Mark an eligible appointment as Not Arrived (NO_SHOW).
 * Enforces 15-minute grace period and preserves existing token numbers in the queue.
 */
export async function receptionistMarkNotArrivedAction(
  appointmentId: string,
  context?: ReceptionistQueueScopeContext
) {
  const user = await requireRole(Role.RECEPTIONIST);

  try {
    const res = await db.$transaction(
      async (tx) =>
        await executeMarkNotArrived({
          tx: buildPrismaStaffOutcomeAdapter(tx),
          actor: { id: user.id, role: Role.RECEPTIONIST },
          appointmentId,
          expectedDoctorId: context?.expectedDoctorId,
          expectedAvailabilityId: context?.expectedAvailabilityId,
        }),
      { maxWait: 10000, timeout: 20000 }
    );

    if (!res.success) {
      return { success: false, error: res.error };
    }

    if (res.doctorId) {
      await checkAndNotifyQueueDelay(res.doctorId);
    }

    revalidateAllQueuePortals();
    return { success: true, message: "Appointment marked as Not Arrived (No-Show)." };
  } catch (error) {
    console.error("[receptionistMarkNotArrivedAction] Error:", error);
    return { success: false, error: "Failed to mark appointment as Not Arrived." };
  }
}

/**
 * Receptionist action: Complete an IN_CONSULTATION appointment (IN_CONSULTATION -> COMPLETED).
 * Records completion timestamp, actualEndAt, and receptionist user audit identity.
 */
export async function receptionistMarkCompletedAction(
  appointmentId: string,
  context?: ReceptionistQueueScopeContext
) {
  const user = await requireRole(Role.RECEPTIONIST);

  try {
    const res = await db.$transaction(
      async (tx) =>
        await executeMarkCompleted({
          tx: buildPrismaStaffOutcomeAdapter(tx),
          actor: { id: user.id, role: Role.RECEPTIONIST },
          appointmentId,
          expectedDoctorId: context?.expectedDoctorId,
          expectedAvailabilityId: context?.expectedAvailabilityId,
        }),
      { maxWait: 10000, timeout: 20000 }
    );

    if (!res.success) {
      return { success: false, error: res.error };
    }

    if (res.doctorId) {
      await checkAndNotifyQueueDelay(res.doctorId);
    }

    revalidateAllQueuePortals();
    return { success: true, message: "Consultation marked as Completed." };
  } catch (error) {
    console.error("[receptionistMarkCompletedAction] Error:", error);
    return { success: false, error: "Failed to mark consultation as Completed." };
  }
}

/**
 * Retired / forbidden Doctor queue-mutation actions.
 * The Doctor Portal is strictly read-only for queue & consultation operations;
 * direct invocation by a Doctor (or other unauthorized caller) is rejected server-side.
 */
export async function callNextPatientAction(input: {
  doctorId?: string;
  availabilityId?: string;
  queueScopeKey?: string;
}) {
  void input;
  await requireUser();
  return {
    success: false,
    error: "Unauthorized: Doctors have read-only queue access. Call Next Patient is managed from the Receptionist Portal.",
  };
}

export async function doctorMarkArrivedAction(appointmentId: string) {
  void appointmentId;
  await requireUser();
  return {
    success: false,
    error: "Unauthorized: Clinic check-in is managed by the Receptionist Portal or patient self-check-in.",
  };
}

export async function startConsultationAction(appointmentId: string) {
  void appointmentId;
  await requireUser();
  return {
    success: false,
    error: "Unauthorized: Start Consultation is managed from the Receptionist Portal.",
  };
}

export async function endConsultationAction(appointmentId: string) {
  void appointmentId;
  await requireUser();
  return {
    success: false,
    error: "Unauthorized: Consultation completion is managed from the Receptionist Portal.",
  };
}

export async function doctorNoShowAction(appointmentId: string) {
  void appointmentId;
  await requireUser();
  return {
    success: false,
    error: "Unauthorized: Not Arrived (No-Show) is managed from the Receptionist Portal.",
  };
}

export async function setPriorityStreamAction(appointmentId: string) {
  void appointmentId;
  await requireUser();
  return {
    success: false,
    error: "Unauthorized: Manual queue priority reordering is disabled.",
  };
}
