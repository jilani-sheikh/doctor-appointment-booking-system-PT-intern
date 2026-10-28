import type { Role, DoctorStatus, SlotStatus, AppointmentStatus, Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth";

/**
 * Minimal serializable user representation passed across the Server-to-Client component boundary
 * for navigation, avatar display, and role-based links.
 * Strictly guarantees no Prisma model instances (such as Decimal on Doctor) leak to Client Components.
 */
export interface NavUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: Role | null;
}

/**
 * Serializes any User or CurrentUser object into a plain NavUser DTO.
 * Safely strips nested doctor (with Prisma.Decimal consultationFee), patient, accounts, and session relations.
 */
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

/**
 * Serializes a Prisma Doctor record with relations into a safe DoctorCardDto.
 */
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
 * Serializable DTO for Patient Appointments View.
 */
export interface SerializedPatientAppointment {
  id: string;
  status: AppointmentStatus;
  reason?: string | null;
  createdAt: string;
  cancelledAt?: string | null;
  slotStartTime: string;
  slotEndTime: string;
  canCancel: boolean;
  doctor: {
    id: string;
    name: string;
    specialization: string;
    qualification?: string | null;
    consultationFee: number;
  };
}

export function toPatientAppointmentDto(
  appt: {
    id: string;
    status: AppointmentStatus;
    reason?: string | null;
    createdAt: Date;
    cancelledAt?: Date | null;
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
  twoHoursFromNow: Date
): SerializedPatientAppointment {
  const isActiveStatus =
    appt.status === "PENDING" || appt.status === "CONFIRMED";
  const canCancel = isActiveStatus && appt.availability.startTime > twoHoursFromNow;

  return {
    id: appt.id,
    status: appt.status,
    reason: appt.reason,
    createdAt: appt.createdAt.toISOString(),
    cancelledAt: appt.cancelledAt ? appt.cancelledAt.toISOString() : null,
    slotStartTime: appt.availability.startTime.toISOString(),
    slotEndTime: appt.availability.endTime.toISOString(),
    canCancel,
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
 * Serializable DTO for Doctor Appointments View.
 */
export interface SerializedDoctorAppointment {
  id: string;
  status: AppointmentStatus;
  reason?: string | null;
  createdAt: string;
  cancelledAt?: string | null;
  slotStartTime: string;
  slotEndTime: string;
  isPastStartTime: boolean;
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
    reason?: string | null;
    createdAt: Date;
    cancelledAt?: Date | null;
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
  return {
    id: appt.id,
    status: appt.status,
    reason: appt.reason,
    createdAt: appt.createdAt.toISOString(),
    cancelledAt: appt.cancelledAt ? appt.cancelledAt.toISOString() : null,
    slotStartTime: appt.availability.startTime.toISOString(),
    slotEndTime: appt.availability.endTime.toISOString(),
    isPastStartTime: now >= appt.availability.startTime,
    patient: {
      id: appt.patient.id,
      name: appt.patient.user.name ?? "Patient",
      phone: appt.patient.phone,
      gender: appt.patient.gender,
    },
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

