import type {
  Role,
  DoctorStatus,
  SlotStatus,
  AppointmentStatus,
  VisitStream,
  WaveStatus,
  NotificationType,
  Prisma,
} from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth";
import {
  canPatientCheckIn,
  canPatientCancel,
  canPatientReschedule,
  canDoctorNoShow,
} from "@/lib/appointment-status";
import { formatWaveArrivalWindowIST } from "@/lib/waves";

/**
 * Minimal serializable user representation passed across the Server-to-Client component boundary.
 * Strictly guarantees no Prisma model instances (such as Decimal on Doctor) leak to Client Components.
 */
export interface NavUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: Role | null;
}

export function toNavUser(
  user?:
    | CurrentUser
    | {
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
        role?: Role | null;
      }
    | null
): NavUser | null {
  if (!user || !user.id) {
    return null;
  }

  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
    role: user.role ?? null,
  };
}

/**
 * Serializable DTO for public doctor listing cards.
 */
export interface DoctorCardDto {
  id: string;
  name: string;
  email?: string | null;
  image?: string | null;
  specialization: string;
  qualification?: string | null;
  consultationFee: number;
  experienceYears?: number | null;
  bio?: string | null;
  status: DoctorStatus;
  isDemo: boolean;
  createdAt: string;
  nextAvailableSlot?: {
    id: string;
    startTime: string;
    endTime: string;
  } | null;
}

export function toDoctorCardDto(doctor: {
  id: string;
  specialization: string;
  qualification?: string | null;
  consultationFee: Prisma.Decimal | number | string;
  experienceYears?: number | null;
  bio?: string | null;
  status: DoctorStatus;
  isDemo: boolean;
  createdAt: Date | string;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  availabilities?: Array<{
    id: string;
    startTime: Date;
    endTime: Date;
  }>;
}): DoctorCardDto {
  const nextSlot = doctor.availabilities?.[0];

  return {
    id: doctor.id,
    name: doctor.user.name ?? "Practitioner",
    email: doctor.user.email ?? null,
    image: doctor.user.image ?? null,
    specialization: doctor.specialization,
    qualification: doctor.qualification ?? null,
    consultationFee: Number(doctor.consultationFee),
    experienceYears: doctor.experienceYears ?? null,
    bio: doctor.bio ?? null,
    status: doctor.status,
    isDemo: doctor.isDemo,
    createdAt: typeof doctor.createdAt === "string" ? doctor.createdAt : doctor.createdAt.toISOString(),
    nextAvailableSlot: nextSlot
      ? {
          id: nextSlot.id,
          startTime: nextSlot.startTime.toISOString(),
          endTime: nextSlot.endTime.toISOString(),
        }
      : null,
  };
}

/**
 * Serializable DTO for Patient Appointments View and Live Queue Card.
 */
export interface SerializedPatientAppointment {
  id: string;
  status: AppointmentStatus;
  stream: VisitStream;
  reason?: string | null;
  createdAt: string;
  cancelledAt?: string | null;
  checkedInAt?: string | null;
  slotStartTime: string;
  slotEndTime: string;
  canCheckIn: boolean;
  canCancel: boolean;
  canReschedule: boolean;
  rescheduleCount: number;
  disruptedAt?: string | null;
  disruptionReason?: string | null;
  arrivalWindow?: string | null;
  estimatedStart?: string | null;
  estimatedDelayMinutes?: number | null;
  queuePosition?: number | null;
  doctor: {
    id: string;
    name: string;
    specialization: string;
    qualification?: string | null;
    consultationFee: number;
  };
  holdExpiresAt?: string | null;
  paymentSessionId?: string | null;
  providerOrderId?: string | null;
  paymentStatus?: string | null;
}

export function toPatientAppointmentDto(
  appt: {
    id: string;
    status: AppointmentStatus;
    stream: VisitStream;
    reason?: string | null;
    createdAt: Date;
    cancelledAt?: Date | null;
    checkedInAt?: Date | null;
    rescheduleCount: number;
    disruptedAt?: Date | null;
    disruptionReason?: string | null;
    wave?: {
      windowStart: Date;
      windowEnd: Date;
      status: WaveStatus;
    } | null;
    holdExpiresAt?: Date | null;
    payments?: Array<{
      id: string;
      providerOrderId: string;
      paymentSessionId?: string | null;
      status: string;
    }>;
    availability: {
      startTime: Date;
      endTime: Date;
      doctor: {
        id: string;
        specialization: string;
        qualification?: string | null;
        consultationFee: Prisma.Decimal | number | string;
        user: {
          name?: string | null;
        };
      };
    };
  },
  now: Date = new Date(),
  estimate?: {
    expectedStart: Date;
    delayMinutes: number;
    roundedDelayMinutes: number;
    queuePosition: number;
  } | null
): SerializedPatientAppointment {
  const checkInEval = canPatientCheckIn(
    {
      status: appt.status,
      startTime: appt.availability.startTime,
      endTime: appt.availability.endTime,
    },
    now
  );

  const cancelEval = canPatientCancel(
    {
      status: appt.status,
      startTime: appt.availability.startTime,
      disruptedAt: appt.disruptedAt,
    },
    now
  );

  const rescheduleEval = canPatientReschedule(
    {
      status: appt.status,
      startTime: appt.availability.startTime,
      rescheduleCount: appt.rescheduleCount,
      disruptedAt: appt.disruptedAt,
    },
    now
  );

  const arrivalWindow =
    appt.wave && appt.wave.status === "PUBLISHED"
      ? formatWaveArrivalWindowIST(appt.wave.windowStart, appt.wave.windowEnd)
      : null;

  const latestPayment = appt.payments && appt.payments.length > 0 ? appt.payments[0] : undefined;

  return {
    id: appt.id,
    status: appt.status,
    stream: appt.stream,
    reason: appt.reason,
    createdAt: appt.createdAt.toISOString(),
    cancelledAt: appt.cancelledAt ? appt.cancelledAt.toISOString() : null,
    checkedInAt: appt.checkedInAt ? appt.checkedInAt.toISOString() : null,
    slotStartTime: appt.availability.startTime.toISOString(),
    slotEndTime: appt.availability.endTime.toISOString(),
    canCheckIn: checkInEval.allowed,
    canCancel: cancelEval.allowed,
    canReschedule: rescheduleEval.allowed,
    rescheduleCount: appt.rescheduleCount,
    disruptedAt: appt.disruptedAt ? appt.disruptedAt.toISOString() : null,
    disruptionReason: appt.disruptionReason,
    arrivalWindow,
    estimatedStart: estimate?.expectedStart.toISOString() ?? null,
    estimatedDelayMinutes: estimate?.roundedDelayMinutes ?? null,
    queuePosition: estimate?.queuePosition ?? null,
    holdExpiresAt: appt.holdExpiresAt ? appt.holdExpiresAt.toISOString() : null,
    paymentSessionId: latestPayment?.paymentSessionId ?? null,
    providerOrderId: latestPayment?.providerOrderId ?? null,
    paymentStatus: latestPayment?.status ?? null,
    doctor: {
      id: appt.availability.doctor.id,
      name: appt.availability.doctor.user.name ?? "Practitioner",
      specialization: appt.availability.doctor.specialization,
      qualification: appt.availability.doctor.qualification,
      consultationFee: Number(appt.availability.doctor.consultationFee),
    },
  };
}

/**
 * Serializable DTO for Doctor Consultations View.
 */
export interface SerializedDoctorAppointment {
  id: string;
  status: AppointmentStatus;
  stream: VisitStream;
  reason?: string | null;
  createdAt: string;
  cancelledAt?: string | null;
  checkedInAt?: string | null;
  slotStartTime: string;
  slotEndTime: string;
  isPastStartTime: boolean;
  canNoShow: boolean;
  patient: {
    id: string;
    name: string;
    phone?: string | null;
    gender?: string | null;
  };
}

export function toDoctorAppointmentDto(
  appt: {
    id: string;
    status: AppointmentStatus;
    stream: VisitStream;
    reason?: string | null;
    createdAt: Date;
    cancelledAt?: Date | null;
    checkedInAt?: Date | null;
    availability: {
      startTime: Date;
      endTime: Date;
    };
    patient: {
      id: string;
      phone?: string | null;
      gender?: string | null;
      user: {
        name?: string | null;
      };
    };
  },
  now: Date
): SerializedDoctorAppointment {
  const noShowEval = canDoctorNoShow(
    {
      status: appt.status,
      startTime: appt.availability.startTime,
    },
    now
  );

  return {
    id: appt.id,
    status: appt.status,
    stream: appt.stream,
    reason: appt.reason,
    createdAt: appt.createdAt.toISOString(),
    cancelledAt: appt.cancelledAt ? appt.cancelledAt.toISOString() : null,
    checkedInAt: appt.checkedInAt ? appt.checkedInAt.toISOString() : null,
    slotStartTime: appt.availability.startTime.toISOString(),
    slotEndTime: appt.availability.endTime.toISOString(),
    isPastStartTime: now >= appt.availability.startTime,
    canNoShow: noShowEval.allowed,
    patient: {
      id: appt.patient.id,
      name: appt.patient.user.name ?? "Patient",
      phone: appt.patient.phone,
      gender: appt.patient.gender,
    },
  };
}

/**
 * Serializable DTO for Doctor Live Queue (/doctor/queue).
 */
export interface SerializedDoctorQueueItem {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string | null;
  reason?: string | null;
  stream: VisitStream;
  status: AppointmentStatus;
  scheduledStart: string;
  scheduledEnd: string;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  checkedInAt?: string | null;
  expectedStart: string;
  expectedEnd: string;
  delayMinutes: number;
  roundedDelayMinutes: number;
  queuePosition: number;
  isCurrent: boolean;
  canMarkArrived: boolean;
  canStartConsultation: boolean;
  canEndConsultation: boolean;
  canNoShow: boolean;
  canCancel: boolean;
  arrivalWindow?: string | null;
  waveStatus?: WaveStatus | null;
}

export function toDoctorQueueItemDto(
  appt: {
    id: string;
    patientId: string;
    patient: {
      phone?: string | null;
      user: { name?: string | null };
    };
    reason?: string | null;
    stream: VisitStream;
    status: AppointmentStatus;
    actualStartAt?: Date | null;
    actualEndAt?: Date | null;
    checkedInAt?: Date | null;
    availability: {
      startTime: Date;
      endTime: Date;
    };
    wave?: {
      status: WaveStatus;
      windowStart: Date;
      windowEnd: Date;
    } | null;
  },
  estimate: {
    expectedStart: Date;
    expectedEnd: Date;
    delayMinutes: number;
    roundedDelayMinutes: number;
    queuePosition: number;
    isCurrent: boolean;
  },
  now: Date
): SerializedDoctorQueueItem {
  const canMarkArrived = appt.status === "CONFIRMED";
  const canStartConsultation = appt.status === "CHECKED_IN";
  const canEndConsultation = appt.status === "IN_CONSULTATION";
  const noShowEval = canDoctorNoShow(
    { status: appt.status, startTime: appt.availability.startTime },
    now
  );
  const canCancel =
    appt.status === "PENDING" ||
    appt.status === "CONFIRMED" ||
    appt.status === "CHECKED_IN";

  const arrivalWindow =
    appt.wave && appt.wave.status === "PUBLISHED"
      ? formatWaveArrivalWindowIST(appt.wave.windowStart, appt.wave.windowEnd)
      : null;

  return {
    id: appt.id,
    patientId: appt.patientId,
    patientName: appt.patient.user.name ?? "Patient",
    patientPhone: appt.patient.phone,
    reason: appt.reason,
    stream: appt.stream,
    status: appt.status,
    scheduledStart: appt.availability.startTime.toISOString(),
    scheduledEnd: appt.availability.endTime.toISOString(),
    actualStartAt: appt.actualStartAt ? appt.actualStartAt.toISOString() : null,
    actualEndAt: appt.actualEndAt ? appt.actualEndAt.toISOString() : null,
    checkedInAt: appt.checkedInAt ? appt.checkedInAt.toISOString() : null,
    expectedStart: estimate.expectedStart.toISOString(),
    expectedEnd: estimate.expectedEnd.toISOString(),
    delayMinutes: estimate.delayMinutes,
    roundedDelayMinutes: estimate.roundedDelayMinutes,
    queuePosition: estimate.queuePosition,
    isCurrent: estimate.isCurrent,
    canMarkArrived,
    canStartConsultation,
    canEndConsultation,
    canNoShow: noShowEval.allowed,
    canCancel,
    arrivalWindow,
    waveStatus: appt.wave?.status ?? null,
  };
}

/**
 * Serializable DTO for Doctor Time Off.
 */
export interface SerializedDoctorTimeOff {
  id: string;
  startAt: string;
  endAt: string;
  reason?: string | null;
  createdAt: string;
  isPast: boolean;
}

export function toDoctorTimeOffDto(
  timeOff: {
    id: string;
    startAt: Date;
    endAt: Date;
    reason?: string | null;
    createdAt: Date;
  },
  now: Date
): SerializedDoctorTimeOff {
  return {
    id: timeOff.id,
    startAt: timeOff.startAt.toISOString(),
    endAt: timeOff.endAt.toISOString(),
    reason: timeOff.reason,
    createdAt: timeOff.createdAt.toISOString(),
    isPast: now.getTime() > timeOff.endAt.getTime(),
  };
}

/**
 * Serializable DTO for Waves.
 */
export interface SerializedWave {
  id: string;
  doctorId?: string | null;
  specialization: string;
  windowStart: string;
  windowEnd: string;
  capacity: number;
  stream?: VisitStream | null;
  status: WaveStatus;
  notes?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  assignedCount: number;
  onTimeCheckIns: number;
  lateCheckIns: number;
  noShows: number;
  notYetArrived: number;
}

export function toWaveDto(
  wave: {
    id: string;
    doctorId?: string | null;
    specialization: string;
    windowStart: Date;
    windowEnd: Date;
    capacity: number;
    stream?: VisitStream | null;
    status: WaveStatus;
    notes?: string | null;
    publishedAt?: Date | null;
    createdAt: Date;
    _count?: {
      appointments: number;
    };
  },
  metrics?: {
    onTimeCheckIns: number;
    lateCheckIns: number;
    noShows: number;
    notYetArrived: number;
  }
): SerializedWave {
  return {
    id: wave.id,
    doctorId: wave.doctorId ?? null,
    specialization: wave.specialization,
    windowStart: wave.windowStart.toISOString(),
    windowEnd: wave.windowEnd.toISOString(),
    capacity: wave.capacity,
    stream: wave.stream ?? null,
    status: wave.status,
    notes: wave.notes,
    publishedAt: wave.publishedAt ? wave.publishedAt.toISOString() : null,
    createdAt: wave.createdAt.toISOString(),
    assignedCount: wave._count?.appointments ?? 0,
    onTimeCheckIns: metrics?.onTimeCheckIns ?? 0,
    lateCheckIns: metrics?.lateCheckIns ?? 0,
    noShows: metrics?.noShows ?? 0,
    notYetArrived: metrics?.notYetArrived ?? 0,
  };
}

/**
 * Serializable DTO for In-App Notifications.
 */
export interface SerializedNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export function toNotificationDto(notification: {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
  readAt?: Date | null;
  createdAt: Date;
}): SerializedNotification {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/**
 * Serializable DTO for Admin Doctor Table.
 */
export interface SerializedAdminDoctor {
  id: string;
  name: string;
  email: string;
  specialization: string;
  qualification?: string | null;
  consultationFee: number;
  experienceYears?: number | null;
  status: DoctorStatus;
  isDemo: boolean;
  createdAt: string;
}

export function toAdminDoctorDto(doctor: {
  id: string;
  specialization: string;
  qualification?: string | null;
  consultationFee: Prisma.Decimal | number | string;
  experienceYears?: number | null;
  status: DoctorStatus;
  isDemo: boolean;
  createdAt: Date;
  user: {
    name?: string | null;
    email?: string | null;
  };
}): SerializedAdminDoctor {
  return {
    id: doctor.id,
    name: doctor.user.name ?? "Practitioner",
    email: doctor.user.email ?? "—",
    specialization: doctor.specialization,
    qualification: doctor.qualification,
    consultationFee: Number(doctor.consultationFee),
    experienceYears: doctor.experienceYears,
    status: doctor.status,
    isDemo: doctor.isDemo,
    createdAt: doctor.createdAt.toISOString(),
  };
}

/**
 * Serializable DTO for Slot List.
 */
export interface SerializedSlot {
  id: string;
  startTime: string;
  endTime: string;
  status: SlotStatus;
}

export function toSlotDto(slot: {
  id: string;
  startTime: Date;
  endTime: Date;
  status: SlotStatus;
}): SerializedSlot {
  return {
    id: slot.id,
    startTime: slot.startTime.toISOString(),
    endTime: slot.endTime.toISOString(),
    status: slot.status,
  };
}

/**
 * Serializable DTO for Public Doctor Slot Booking.
 */
export interface SerializedPublicSlot {
  id: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
}

export function toPublicSlotDto(slot: {
  id: string;
  startTime: Date;
  endTime: Date;
}): SerializedPublicSlot {
  return {
    id: slot.id,
    startTime: slot.startTime.toISOString(),
    endTime: slot.endTime.toISOString(),
  };
}

/**
 * Serializable DTO for Refund items.
 */
export interface SerializedRefundItem {
  id: string;
  providerRefundId: string;
  providerRefundRef: string | null;
  amount: number;
  reason: string;
  note: string | null;
  status: string;
  failureReason: string | null;
  attempts: number;
  requestedAt: string;
  processedAt: string | null;
}

export function toRefundDto(refund: {
  id: string;
  providerRefundId: string;
  providerRefundRef?: string | null;
  amount: Prisma.Decimal | number | string;
  reason: string;
  note?: string | null;
  status: string;
  failureReason?: string | null;
  attempts: number;
  requestedAt: Date;
  processedAt?: Date | null;
}): SerializedRefundItem {
  return {
    id: refund.id,
    providerRefundId: refund.providerRefundId,
    providerRefundRef: refund.providerRefundRef ?? null,
    amount: Number(refund.amount),
    reason: refund.reason,
    note: refund.note ?? null,
    status: refund.status,
    failureReason: refund.failureReason ?? null,
    attempts: refund.attempts,
    requestedAt: refund.requestedAt.toISOString(),
    processedAt: refund.processedAt ? refund.processedAt.toISOString() : null,
  };
}

/**
 * Serializable DTO for Payment History, Receipts, and Admin Oversight.
 */
export interface SerializedPaymentItem {
  id: string;
  appointmentId: string;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  paymentSessionId: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  failureReason: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  doctorName: string;
  doctorSpecialization: string;
  slotStartTime: string;
  slotEndTime?: string | null;
  totalRefunded: number;
  refundStatus: string | null;
  refunds: SerializedRefundItem[];
}

export function toPaymentDto(payment: {
  id: string;
  appointmentId: string;
  provider: string;
  providerOrderId: string;
  providerPaymentId?: string | null;
  paymentSessionId?: string | null;
  amount: Prisma.Decimal | number | string;
  currency: string;
  status: string;
  method?: string | null;
  failureReason?: string | null;
  needsAttention: boolean;
  attentionReason?: string | null;
  expiresAt: Date;
  paidAt?: Date | null;
  createdAt: Date;
  appointment?: {
    availability?: {
      startTime: Date;
      endTime?: Date;
      doctor?: {
        specialization: string;
        user?: { name?: string | null } | null;
      } | null;
    } | null;
  } | null;
  refunds?: Array<Parameters<typeof toRefundDto>[0]>;
}): SerializedPaymentItem {
  const refunds = payment.refunds ? payment.refunds.map(toRefundDto) : [];
  const successfulRefunds = refunds.filter((r) => r.status === "SUCCESS");
  const pendingRefunds = refunds.filter((r) => r.status === "PENDING" || r.status === "REQUESTED");
  const totalRefunded = successfulRefunds.reduce((sum, r) => sum + r.amount, 0);

  let refundStatus: string | null = null;
  const paymentAmountNum = Number(payment.amount);
  if (totalRefunded >= paymentAmountNum && paymentAmountNum > 0) {
    refundStatus = "Refunded";
  } else if (totalRefunded > 0) {
    refundStatus = "Partially Refunded";
  } else if (pendingRefunds.length > 0) {
    refundStatus = "Refund Pending";
  }

  const doctorName =
    payment.appointment?.availability?.doctor?.user?.name ?? "Practitioner";
  const doctorSpecialization =
    payment.appointment?.availability?.doctor?.specialization ?? "General";
  const slotStartTime = payment.appointment?.availability?.startTime
    ? payment.appointment.availability.startTime.toISOString()
    : payment.createdAt.toISOString();
  const slotEndTime = payment.appointment?.availability?.endTime
    ? payment.appointment.availability.endTime.toISOString()
    : null;

  return {
    id: payment.id,
    appointmentId: payment.appointmentId,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId ?? null,
    paymentSessionId: payment.paymentSessionId ?? null,
    amount: paymentAmountNum,
    currency: payment.currency,
    status: payment.status,
    method: payment.method ?? null,
    failureReason: payment.failureReason ?? null,
    needsAttention: payment.needsAttention,
    attentionReason: payment.attentionReason ?? null,
    expiresAt: payment.expiresAt.toISOString(),
    paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
    createdAt: payment.createdAt.toISOString(),
    doctorName,
    doctorSpecialization,
    slotStartTime,
    slotEndTime,
    totalRefunded,
    refundStatus,
    refunds,
  };
}

