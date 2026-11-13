import "server-only";
import { AiConfirmationStatus, Role } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getAuthSecret } from "@/lib/env";
import {
  DEFAULT_CONFIRMATION_TTL_MS,
  hashConfirmationPayload,
  signConfirmationToken,
  verifyConfirmationToken,
} from "@/lib/ai/confirmation-token";
import {
  confirmPayloadSchemas,
  type ConfirmActionType,
  type ConfirmResponsePayload,
  type PendingConfirmation,
} from "@/lib/ai/schemas";
import { bookAppointmentAction, cancelPatientAppointmentAction } from "@/lib/actions/appointments";
import { cancelHoldAction, resumeHoldPaymentAction } from "@/lib/actions/payments";
import {
  doctorRescheduleAppointmentAction,
  patientRescheduleAppointmentAction,
  resolveDisruptedAppointmentManuallyAction,
} from "@/lib/actions/reschedule";
import { patientCheckInAction } from "@/lib/actions/queue";
import {
  blockScheduleDateAction,
  createScheduleAction,
  expandAvailabilityAction,
  shrinkAvailabilityAction,
  toggleBlockSlotAction,
  unblockScheduleDateAction,
} from "@/lib/actions/slots";
import { createDoctorTimeOffAction, deleteDoctorTimeOffAction } from "@/lib/actions/time-off";
import { updateDoctorAppointmentStatusAction } from "@/lib/actions/doctor-appointments";

export interface AuthenticatedAssistantUser {
  id: string;
  role: "PATIENT" | "DOCTOR";
}

function getActionExpectedRole(action: ConfirmActionType): "PATIENT" | "DOCTOR" {
  return action.startsWith("PATIENT_") ? "PATIENT" : "DOCTOR";
}

/**
 * Persists a pending single-use confirmation record and returns a signed confirmation card payload.
 */
export async function createPendingConfirmation(input: {
  userId: string;
  role: "PATIENT" | "DOCTOR";
  action: ConfirmActionType;
  payload: Record<string, unknown>;
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<PendingConfirmation> {
  if (getActionExpectedRole(input.action) !== input.role) {
    throw new Error("Role mismatch while creating AI confirmation.");
  }

  const schema = confirmPayloadSchemas[input.action];
  const parsedPayload = schema.parse(input.payload) as Record<string, unknown>;
  const payloadHash = hashConfirmationPayload(input.action, parsedPayload);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_CONFIRMATION_TTL_MS);

  const row = await db.aiConfirmation.create({
    data: {
      userId: input.userId,
      role: input.role === "PATIENT" ? Role.PATIENT : Role.DOCTOR,
      action: input.action,
      payloadHash,
      expiresAt,
      status: AiConfirmationStatus.PENDING,
    },
    select: {
      id: true,
    },
  });

  const { token } = signConfirmationToken(
    {
      confirmationId: row.id,
      userId: input.userId,
      role: input.role,
      action: input.action,
      payload: parsedPayload,
      issuedAt: now.getTime(),
      expiresAt: expiresAt.getTime(),
    },
    getAuthSecret()
  );

  return {
    confirmationId: row.id,
    token,
    action: input.action,
    title: input.title,
    summary: input.summary,
    details: input.details,
    warning: input.warning,
    expiresAt: expiresAt.toISOString(),
    confirmLabel: input.confirmLabel ?? "Confirm",
    cancelLabel: input.cancelLabel ?? "Cancel",
  };
}

interface GenericActionOutcome {
  success?: boolean;
  error?: string;
  message?: string;
  appointmentId?: string;
  requiresPayment?: boolean;
  orderId?: string;
  paymentSessionId?: string;
  data?: unknown;
}

async function dispatchBoundAction(
  action: ConfirmActionType,
  rawPayload: Record<string, unknown>
): Promise<GenericActionOutcome> {
  switch (action) {
    case "PATIENT_BOOK_APPOINTMENT": {
      const data = confirmPayloadSchemas.PATIENT_BOOK_APPOINTMENT.parse(rawPayload);
      return await bookAppointmentAction({
        availabilityId: data.availabilityId,
        stream: data.stream,
        ...(data.reason ? { reason: data.reason } : {}),
      });
    }
    case "PATIENT_RESCHEDULE_APPOINTMENT": {
      const data = confirmPayloadSchemas.PATIENT_RESCHEDULE_APPOINTMENT.parse(rawPayload);
      return await patientRescheduleAppointmentAction(data);
    }
    case "PATIENT_CANCEL_APPOINTMENT": {
      const data = confirmPayloadSchemas.PATIENT_CANCEL_APPOINTMENT.parse(rawPayload);
      return await cancelPatientAppointmentAction(data.appointmentId);
    }
    case "PATIENT_CANCEL_HOLD": {
      const data = confirmPayloadSchemas.PATIENT_CANCEL_HOLD.parse(rawPayload);
      return await cancelHoldAction(data.appointmentId);
    }
    case "PATIENT_RESUME_PAYMENT": {
      const data = confirmPayloadSchemas.PATIENT_RESUME_PAYMENT.parse(rawPayload);
      return await resumeHoldPaymentAction(data.appointmentId);
    }
    case "PATIENT_CHECK_IN": {
      const data = confirmPayloadSchemas.PATIENT_CHECK_IN.parse(rawPayload);
      return await patientCheckInAction(data.appointmentId);
    }
    case "DOCTOR_SHRINK_AVAILABILITY": {
      const data = confirmPayloadSchemas.DOCTOR_SHRINK_AVAILABILITY.parse(rawPayload);
      return await shrinkAvailabilityAction(data);
    }
    case "DOCTOR_EXPAND_AVAILABILITY": {
      const data = confirmPayloadSchemas.DOCTOR_EXPAND_AVAILABILITY.parse(rawPayload);
      return await expandAvailabilityAction(data);
    }
    case "DOCTOR_BLOCK_SCHEDULE_DATE": {
      const data = confirmPayloadSchemas.DOCTOR_BLOCK_SCHEDULE_DATE.parse(rawPayload);
      return await blockScheduleDateAction(data.scheduleId, data.date, data.confirmCancellation);
    }
    case "DOCTOR_UNBLOCK_SCHEDULE_DATE": {
      const data = confirmPayloadSchemas.DOCTOR_UNBLOCK_SCHEDULE_DATE.parse(rawPayload);
      return await unblockScheduleDateAction(data.scheduleId, data.date);
    }
    case "DOCTOR_TOGGLE_BLOCK_SLOT": {
      const data = confirmPayloadSchemas.DOCTOR_TOGGLE_BLOCK_SLOT.parse(rawPayload);
      return await toggleBlockSlotAction(data.slotId);
    }
    case "DOCTOR_CREATE_SCHEDULE": {
      const data = confirmPayloadSchemas.DOCTOR_CREATE_SCHEDULE.parse(rawPayload);
      const { confirmOverrideCancellation, ...scheduleInput } = data;
      return await createScheduleAction(
        scheduleInput,
        Boolean(confirmOverrideCancellation)
      );
    }
    case "DOCTOR_CREATE_TIME_OFF": {
      const data = confirmPayloadSchemas.DOCTOR_CREATE_TIME_OFF.parse(rawPayload);
      return await createDoctorTimeOffAction(data);
    }
    case "DOCTOR_DELETE_TIME_OFF": {
      const data = confirmPayloadSchemas.DOCTOR_DELETE_TIME_OFF.parse(rawPayload);
      return await deleteDoctorTimeOffAction(data);
    }
    case "DOCTOR_CANCEL_APPOINTMENT": {
      const data = confirmPayloadSchemas.DOCTOR_CANCEL_APPOINTMENT.parse(rawPayload);
      return await updateDoctorAppointmentStatusAction(data.appointmentId, "CANCELLED");
    }
    case "DOCTOR_COMPLETE_APPOINTMENT": {
      const data = confirmPayloadSchemas.DOCTOR_COMPLETE_APPOINTMENT.parse(rawPayload);
      return await updateDoctorAppointmentStatusAction(data.appointmentId, "COMPLETED");
    }
    case "DOCTOR_MARK_NO_SHOW": {
      const data = confirmPayloadSchemas.DOCTOR_MARK_NO_SHOW.parse(rawPayload);
      return await updateDoctorAppointmentStatusAction(data.appointmentId, "NO_SHOW");
    }
    case "DOCTOR_RESCHEDULE_APPOINTMENT": {
      const data = confirmPayloadSchemas.DOCTOR_RESCHEDULE_APPOINTMENT.parse(rawPayload);
      return await doctorRescheduleAppointmentAction(data);
    }
    case "DOCTOR_RESOLVE_DISRUPTED_MANUALLY": {
      const data = confirmPayloadSchemas.DOCTOR_RESOLVE_DISRUPTED_MANUALLY.parse(rawPayload);
      return await resolveDisruptedAppointmentManuallyAction(
        data.appointmentId,
        data.resolutionNote
      );
    }
  }
}

/**
 * Verifies a signed confirmation token, atomically claims its DB record so it
 * cannot be replayed, and executes the bound action once via existing domain services.
 */
export async function executeConfirmedAction(input: {
  token: string;
  user: AuthenticatedAssistantUser;
}): Promise<{ status: number; body: ConfirmResponsePayload }> {
  const verified = verifyConfirmationToken({
    token: input.token,
    expectedUserId: input.user.id,
    expectedRole: input.user.role,
    secret: getAuthSecret(),
  });

  if (!verified.ok) {
    const httpStatus =
      verified.code === "FORBIDDEN" ? 403 : verified.code === "EXPIRED" ? 410 : 400;
    return {
      status: httpStatus,
      body: {
        success: false,
        message: verified.error,
        error: verified.error,
      },
    };
  }

  const { claims } = verified;
  if (getActionExpectedRole(claims.action) !== input.user.role) {
    return {
      status: 403,
      body: {
        success: false,
        message: "This action is not allowed for your role.",
        error: "Role mismatch.",
      },
    };
  }

  const schema = confirmPayloadSchemas[claims.action];
  const parsedPayload = schema.safeParse(claims.payload);
  if (!parsedPayload.success) {
    return {
      status: 400,
      body: {
        success: false,
        message: "Invalid action parameters in confirmation token.",
        error: "Invalid action parameters.",
      },
    };
  }

  const expectedHash = hashConfirmationPayload(claims.action, parsedPayload.data as Record<string, unknown>);
  const now = new Date();

  const claimResult = await db.aiConfirmation.updateMany({
    where: {
      id: claims.confirmationId,
      userId: input.user.id,
      role: input.user.role === "PATIENT" ? Role.PATIENT : Role.DOCTOR,
      action: claims.action,
      payloadHash: expectedHash,
      status: AiConfirmationStatus.PENDING,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      status: AiConfirmationStatus.CONSUMING,
      consumedAt: now,
    },
  });

  if (claimResult.count !== 1) {
    return {
      status: 409,
      body: {
        success: false,
        message: "This confirmation request has already been used or expired.",
        error: "Confirmation already consumed or expired.",
      },
    };
  }

  try {
    const outcome = await dispatchBoundAction(
      claims.action,
      parsedPayload.data as Record<string, unknown>
    );

    if (!outcome?.success) {
      const errMessage = outcome?.error || outcome?.message || "Unable to complete action.";
      await db.aiConfirmation.update({
        where: { id: claims.confirmationId },
        data: {
          status: AiConfirmationStatus.FAILED,
          error: errMessage,
        },
      });
      return {
        status: 400,
        body: {
          success: false,
          message: errMessage,
          error: errMessage,
        },
      };
    }

    await db.aiConfirmation.update({
      where: { id: claims.confirmationId },
      data: {
        status: AiConfirmationStatus.EXECUTED,
        error: null,
      },
    });

    const dataObj =
      outcome.data && typeof outcome.data === "object"
        ? (outcome.data as Record<string, unknown>)
        : null;
    const appointmentId =
      outcome.appointmentId ??
      (typeof dataObj?.appointmentId === "string" ? dataObj.appointmentId : undefined);
    const requiresPayment =
      Boolean(outcome.requiresPayment) ||
      Boolean(outcome.paymentSessionId && outcome.orderId);

    return {
      status: 200,
      body: {
        success: true,
        message: outcome.message || "Action completed successfully.",
        appointmentId,
        requiresPayment,
        orderId: outcome.orderId,
        paymentSessionId: outcome.paymentSessionId,
      },
    };
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : "Unexpected error while executing confirmed action.";
    await db.aiConfirmation
      .update({
        where: { id: claims.confirmationId },
        data: {
          status: AiConfirmationStatus.FAILED,
          error: errMessage,
        },
      })
      .catch(() => {});

    return {
      status: 500,
      body: {
        success: false,
        message: errMessage,
        error: errMessage,
      },
    };
  }
}
