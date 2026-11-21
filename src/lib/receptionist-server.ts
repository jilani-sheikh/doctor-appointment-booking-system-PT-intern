import "server-only";

import { DoctorStatus, Role } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  buildReceptionistDashboardData,
  type ReceptionistDashboardData,
} from "@/lib/receptionist";
import { getISTDayRangeUTC, getTodayISTDateString } from "@/lib/time";

/**
 * Loads appointments for the selected IST clinic date (defaulting to today IST)
 * and approved clinic doctors for the Receptionist Portal.
 * Enforces `Role.RECEPTIONIST` at the data access boundary.
 */
export async function getReceptionistDashboardData(
  selectedDateISTParam?: string,
  now: Date = new Date()
): Promise<ReceptionistDashboardData> {
  await requireRole(Role.RECEPTIONIST);

  const todayIST = getTodayISTDateString();
  const targetDateIST =
    selectedDateISTParam && /^\d{4}-\d{2}-\d{2}$/.test(selectedDateISTParam)
      ? selectedDateISTParam
      : todayIST;

  const dayRange = getISTDayRangeUTC(targetDateIST);
  const queryStart = new Date(dayRange.start.getTime() - 24 * 60 * 60 * 1000);
  const queryEnd = new Date(dayRange.nextDayStart.getTime() + 24 * 60 * 60 * 1000);

  const [rawAppointments, rawApprovedDoctors] = await Promise.all([
    db.appointment.findMany({
      where: {
        OR: [
          {
            slotStart: {
              gte: queryStart,
              lt: queryEnd,
            },
          },
          {
            availability: {
              startTime: {
                gte: queryStart,
                lt: queryEnd,
              },
            },
          },
        ],
      },
      include: {
        wave: {
          select: {
            windowStart: true,
            windowEnd: true,
            status: true,
          },
        },
        patient: {
          select: {
            id: true,
            phone: true,
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        availability: {
          select: {
            id: true,
            kind: true,
            startTime: true,
            endTime: true,
            doctor: {
              select: {
                id: true,
                specialization: true,
                user: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        availability: {
          startTime: "asc",
        },
      },
    }),
    db.doctor.findMany({
      where: { status: DoctorStatus.APPROVED },
      select: {
        id: true,
        specialization: true,
        user: { select: { name: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const approvedDoctorsList = rawApprovedDoctors.map((doc) => ({
    id: doc.id,
    name: doc.user.name ?? "Practitioner",
    specialization: doc.specialization,
  }));

  return buildReceptionistDashboardData(
    rawAppointments,
    now,
    [],
    targetDateIST,
    approvedDoctorsList
  );
}
