import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role, AppointmentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getTodayISTDateString, getISTDateString } from "@/lib/time";
import {
  effectiveSlot,
  isEligibleForDisruptedDashboardAlternatives,
} from "@/lib/scheduling";
import { discoverAlternativeAppointmentsForPatient } from "@/lib/actions/reschedule";
import { calculateQueueEstimates, type QueueAppointmentItem } from "@/lib/queue";
import { AppointmentsView } from "./appointments-view";
import { toPatientAppointmentDto, type SerializedPatientAppointment } from "@/lib/serializers";
import { Calendar, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "My Consultations — Medrella",
  description: "View and manage your upcoming and past medical consultations, check in, and view queue progress.",
};

export default async function PatientAppointmentsPage() {
  const user = await requireRole(Role.PATIENT);
  const patient = user.patient;

  if (!patient) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-12 text-center">
        <p className="text-muted-foreground">Please complete your patient onboarding profile.</p>
      </div>
    );
  }

  const now = new Date();
  const todayISTStr = getTodayISTDateString();

  const rawAppointments = await db.appointment.findMany({
    where: {
      patientId: patient.id,
    },
    include: {
      wave: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      availability: {
        include: {
          doctor: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
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
  });

  // Calculate doctor queue estimates for any appointment scheduled for today
  const doctorIdsToday = new Set<string>();
  for (const a of rawAppointments) {
    if (getISTDateString(effectiveSlot(a).start) === todayISTStr) {
      doctorIdsToday.add(a.availability.doctorId);
    }
  }

  // Pre-fetch today's queue for each relevant doctor
  const doctorEstimatesMap = new Map<string, ReturnType<typeof calculateQueueEstimates>>();
  for (const docId of doctorIdsToday) {
    const docAppts = await db.appointment.findMany({
      where: {
        availability: { doctorId: docId },
      },
      include: { availability: true },
      orderBy: { availability: { startTime: "asc" } },
    });

    const todayDocAppts = docAppts.filter(
      (a) => getISTDateString(effectiveSlot(a).start) === todayISTStr
    );

    const queueItems: QueueAppointmentItem[] = todayDocAppts.map((a) => ({
      id: a.id,
      status: a.status,
      scheduledStart: effectiveSlot(a).start,
      scheduledEnd: effectiveSlot(a).end,
      actualStartAt: a.actualStartAt,
      actualEndAt: a.actualEndAt,
      checkedInAt: a.checkedInAt,
    }));

    doctorEstimatesMap.set(docId, calculateQueueEstimates(queueItems, now));
  }

  const upcoming: SerializedPatientAppointment[] = [];
  const past: SerializedPatientAppointment[] = [];

  for (const appt of rawAppointments) {
    const appointmentSlot = effectiveSlot(appt);
    const isToday = getISTDateString(appointmentSlot.start) === todayISTStr;
    const isFuture = appointmentSlot.start >= now;
    const isActiveStatus =
      appt.status === AppointmentStatus.PENDING ||
      appt.status === AppointmentStatus.PENDING_PAYMENT ||
      appt.status === AppointmentStatus.CONFIRMED ||
      appt.status === AppointmentStatus.CHECKED_IN ||
      appt.status === AppointmentStatus.IN_CONSULTATION;

    let estimate = null;
    if (isToday) {
      const docEstimates = doctorEstimatesMap.get(appt.availability.doctorId);
      if (docEstimates) {
        estimate = docEstimates.get(appt.id) ?? null;
      }
    }

    let suggestedAlternatives = null;
    if (
      isEligibleForDisruptedDashboardAlternatives(
        {
          status: appt.status,
          startTime: appointmentSlot.start,
          disruptedAt: appt.disruptedAt,
          rescheduleStatus: appt.rescheduleStatus,
        },
        now
      )
    ) {
      suggestedAlternatives = await discoverAlternativeAppointmentsForPatient(appt.id, now);
    }

    const serialized = toPatientAppointmentDto(
      appt,
      now,
      estimate,
      suggestedAlternatives
    );

    if ((isFuture || isToday) && isActiveStatus) {
      upcoming.push(serialized);
    } else {
      past.push(serialized);
    }
  }

  // Past sorted most recent first
  past.sort((a, b) => new Date(b.slotStartTime).getTime() - new Date(a.slotStartTime).getTime());

  return (
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Calendar className="h-7 w-7 text-primary" />
            My Consultations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your upcoming consultations, self-check-in, view live queue delays, or manage rescheduling.
          </p>
        </div>

        <Link
          href="/doctors"
          className={buttonVariants({ className: "gap-1.5 shadow-xs" })}
        >
          <Plus className="h-4 w-4" />
          Book New Appointment
        </Link>
      </div>

      <AppointmentsView
        upcomingAppointments={upcoming}
        pastAppointments={past}
      />
    </div>
  );
}
