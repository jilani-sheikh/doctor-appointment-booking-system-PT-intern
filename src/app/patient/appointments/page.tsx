import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role, AppointmentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppointmentsView, type SerializedPatientAppointment } from "./appointments-view";
import { Calendar, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "My Appointments — Medrella",
  description: "View and manage your upcoming and past medical consultations.",
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
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const rawAppointments = await db.appointment.findMany({
    where: {
      patientId: patient.id,
    },
    include: {
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

  const upcoming: SerializedPatientAppointment[] = [];
  const past: SerializedPatientAppointment[] = [];

  for (const appt of rawAppointments) {
    const isFuture = appt.availability.startTime >= now;
    const isActiveStatus =
      appt.status === AppointmentStatus.PENDING || appt.status === AppointmentStatus.CONFIRMED;

    const canCancel = isActiveStatus && appt.availability.startTime > twoHoursFromNow;

    const serialized: SerializedPatientAppointment = {
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

    if (isFuture && isActiveStatus) {
      upcoming.push(serialized);
    } else {
      past.push(serialized);
    }
  }

  // Past sorted most recent first
  past.sort((a, b) => new Date(b.slotStartTime).getTime() - new Date(a.slotStartTime).getTime());

  return (
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Calendar className="h-7 w-7 text-primary" />
            My Consultations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your upcoming doctor appointments, review past consultation history, or make cancellations.
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
