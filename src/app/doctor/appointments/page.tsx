import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role, DoctorStatus, AppointmentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getTodayISTDateString, getISTDateString } from "@/lib/time";
import { DoctorAppointmentsView } from "./doctor-appointments-view";
import { toDoctorAppointmentDto, type SerializedDoctorAppointment } from "@/lib/serializers";
import { Calendar, Stethoscope, ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Patient Consultations — Doctor Portal",
  description: "Manage patient appointments, review schedules, and record consultation outcomes.",
};

export default async function DoctorAppointmentsPage() {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-12">
        <div className="rounded-xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-8 text-center space-y-4">
          <ShieldAlert className="h-8 w-8 text-amber-600 dark:text-amber-400 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Appointments Locked</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Your doctor profile is currently{" "}
            <span className="font-semibold text-foreground uppercase">{doctor?.status ?? "PENDING"}</span>.
            Consultation management is only accessible for approved medical practitioners.
          </p>
          <div className="pt-2">
            <Link href="/doctor/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const now = new Date();
  const todayISTStr = getTodayISTDateString();

  const rawAppointments = await db.appointment.findMany({
    where: {
      availability: {
        doctorId: doctor.id,
      },
    },
    include: {
      availability: true,
      patient: {
        include: {
          user: {
            select: {
              name: true,
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

  const today: SerializedDoctorAppointment[] = [];
  const upcoming: SerializedDoctorAppointment[] = [];
  const history: SerializedDoctorAppointment[] = [];

  for (const appt of rawAppointments) {
    const slotDateISTStr = getISTDateString(appt.availability.startTime);
    const isToday = slotDateISTStr === todayISTStr;
    const isFutureTime = appt.availability.startTime > now;
    const isTerminal =
      appt.status === AppointmentStatus.COMPLETED ||
      appt.status === AppointmentStatus.CANCELLED ||
      appt.status === AppointmentStatus.NO_SHOW;

    const serialized = toDoctorAppointmentDto(appt, now);

    if (isTerminal) {
      history.push(serialized);
    } else if (isToday) {
      today.push(serialized);
    } else if (isFutureTime) {
      upcoming.push(serialized);
    } else {
      history.push(serialized);
    }
  }

  // History sorted most recent first
  history.sort((a, b) => new Date(b.slotStartTime).getTime() - new Date(a.slotStartTime).getTime());

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Stethoscope className="h-7 w-7 text-primary" />
            Patient Consultations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review booked consultations, track patient attendance, and record consultation outcomes.
          </p>
        </div>

        <Link
          href="/doctor/slots"
          className={buttonVariants({ variant: "outline", className: "gap-1.5" })}
        >
          <Calendar className="h-4 w-4" />
          Manage Slots
        </Link>
      </div>

      <DoctorAppointmentsView
        todayAppointments={today}
        upcomingAppointments={upcoming}
        historyAppointments={history}
      />
    </div>
  );
}
