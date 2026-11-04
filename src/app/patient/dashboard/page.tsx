import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role, AppointmentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Calendar, User, Clock, ArrowRight, Activity, AlertCircle } from "lucide-react";
import { formatDateIST, formatTimeIST, formatSlotRange, formatSlotDateTimeRangeIST, getTodayISTDateString, getISTDateString } from "@/lib/time";
import { calculateQueueEstimates, EMERGENCY_DISCLAIMER, type QueueAppointmentItem } from "@/lib/queue";
import { formatWaveArrivalWindowIST } from "@/lib/waves";

export const metadata: Metadata = {
  title: "Patient Dashboard — Medrella",
  description: "View upcoming appointments, live queue status, and manage consultations.",
};

export default async function PatientDashboardPage() {
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

  // Query appointments for counts and active appointments
  const allAppointments = await db.appointment.findMany({
    where: {
      patientId: patient.id,
    },
    include: {
      wave: true,
      availability: {
        include: {
          doctor: {
            include: {
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
  });

  const upcomingAppts = allAppointments.filter((a) => {
    const isFutureOrToday =
      a.availability.startTime >= now ||
      getISTDateString(a.availability.startTime) === todayISTStr;
    const isActive =
      a.status === AppointmentStatus.PENDING ||
      a.status === AppointmentStatus.CONFIRMED ||
      a.status === AppointmentStatus.CHECKED_IN ||
      a.status === AppointmentStatus.IN_CONSULTATION;
    return isFutureOrToday && isActive;
  });

  const pastApptsCount = allAppointments.length - upcomingAppts.length;
  const nextAppointment = upcomingAppts[0] ?? null;

  // Find active appointment for today (if any)
  const todayActiveAppt = upcomingAppts.find(
    (a) => getISTDateString(a.availability.startTime) === todayISTStr
  );

  let todayQueueEstimate = null;
  if (todayActiveAppt) {
    const docAppts = await db.appointment.findMany({
      where: {
        availability: { doctorId: todayActiveAppt.availability.doctorId },
      },
      include: { availability: true },
      orderBy: { availability: { startTime: "asc" } },
    });

    const todayDocAppts = docAppts.filter(
      (a) => getISTDateString(a.availability.startTime) === todayISTStr
    );

    const queueItems: QueueAppointmentItem[] = todayDocAppts.map((a) => ({
      id: a.id,
      status: a.status,
      scheduledStart: a.availability.startTime,
      scheduledEnd: a.availability.endTime,
      actualStartAt: a.actualStartAt,
      actualEndAt: a.actualEndAt,
      checkedInAt: a.checkedInAt,
    }));

    const estimates = calculateQueueEstimates(queueItems, now);
    todayQueueEstimate = estimates.get(todayActiveAppt.id) ?? null;
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider">
              Patient Portal
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            Welcome back, {user.name ?? "Patient"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your medical appointments, track live queue positions, and view your profile.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/doctors"
            className={buttonVariants({ variant: "default", className: "shadow-sm flex items-center" })}
          >
            <Calendar className="h-4 w-4 mr-2" />
            Book Appointment
          </Link>
          <Link
            href="/patient/appointments"
            className={buttonVariants({ variant: "outline", className: "flex items-center" })}
          >
            <Clock className="h-4 w-4 mr-2" />
            My Consultations
          </Link>
        </div>
      </div>

      {/* Emergency Notice */}
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-primary shrink-0" />
        <span>{EMERGENCY_DISCLAIMER}</span>
      </div>

      {/* Live "Today" Active Queue Card */}
      {todayActiveAppt && (
        <Card className="border-blue-500/40 bg-blue-50/20 dark:bg-blue-950/20 shadow-md">
          <CardHeader className="pb-3 border-b border-blue-200 dark:border-blue-900/60 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600 animate-pulse" />
              Today&apos;s Active Consultation
            </CardTitle>
            <Link
              href="/patient/appointments"
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              View Full Live Queue <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-base font-bold text-foreground">
                  Dr. {todayActiveAppt.availability.doctor.user.name}
                </span>
                <span className="text-xs text-muted-foreground block">
                  {todayActiveAppt.availability.doctor.specialization}
                </span>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">
                    Scheduled: {formatSlotRange(todayActiveAppt.availability.startTime, todayActiveAppt.availability.endTime)}
                  </span>
                  {todayActiveAppt.wave && todayActiveAppt.wave.status === "PUBLISHED" && (
                    <>
                      <span>•</span>
                      <span className="text-primary font-semibold">
                        Arrival Window: {formatWaveArrivalWindowIST(todayActiveAppt.wave.windowStart, todayActiveAppt.wave.windowEnd)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    todayActiveAppt.status === "CHECKED_IN"
                      ? "warning"
                      : todayActiveAppt.status === "IN_CONSULTATION"
                      ? "default"
                      : "success"
                  }
                  className="text-xs uppercase font-semibold"
                >
                  {todayActiveAppt.status === "CHECKED_IN"
                    ? "Arrived / Waiting"
                    : todayActiveAppt.status === "IN_CONSULTATION"
                    ? "In Consultation"
                    : todayActiveAppt.status}
                </Badge>
              </div>
            </div>

            {todayQueueEstimate && (
              <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-4 text-xs flex-wrap">
                <span className="font-semibold text-foreground">
                  Queue Position: #{todayQueueEstimate.queuePosition}
                </span>
                <span>•</span>
                <span>
                  Est. Start: <strong>{formatTimeIST(todayQueueEstimate.expectedStart)}</strong>
                  {todayQueueEstimate.roundedDelayMinutes > 0 && (
                    <span className="text-rose-600 font-semibold ml-1">
                      (+{todayQueueEstimate.roundedDelayMinutes} min approx)
                    </span>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border shadow-xs">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs">Upcoming Appointments</CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {upcomingAppts.length}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs">Past Consultations</CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {pastApptsCount}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs">Total Bookings</CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {allAppointments.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="shadow-sm border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Patient Profile
            </CardTitle>
            <CardDescription className="text-xs">Your registered personal details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Full Name</p>
              <p className="font-medium text-foreground">{user.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium text-foreground">{user.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone Number</p>
              <p className="font-medium text-foreground">{patient?.phone ?? "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date of Birth</p>
              <p className="font-medium text-foreground">
                {patient?.dateOfBirth ? formatDateIST(patient.dateOfBirth) : "Not provided"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Gender</p>
              <p className="font-medium text-foreground">{patient?.gender ?? "Not specified"}</p>
            </div>
          </CardContent>
        </Card>

        {/* Next Appointment Card */}
        <Card className="md:col-span-2 shadow-sm border-border bg-card flex flex-col justify-between">
          <div>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Next Consultation
                </CardTitle>
                <Link
                  href="/patient/appointments"
                  className="text-xs text-primary font-medium hover:underline"
                >
                  View All ({upcomingAppts.length}) →
                </Link>
              </div>
              <CardDescription className="text-xs">
                Your closest upcoming medical consultation
              </CardDescription>
            </CardHeader>
            <CardContent>
              {nextAppointment ? (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-lg font-bold text-foreground">
                        Dr. {nextAppointment.availability.doctor.user.name}
                      </span>
                      <p className="text-xs text-primary font-medium">
                        {nextAppointment.availability.doctor.specialization}
                      </p>
                    </div>

                    <Badge
                      variant={nextAppointment.status === "CONFIRMED" ? "success" : "warning"}
                      className="text-[10px] uppercase"
                    >
                      {nextAppointment.status}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-foreground font-semibold pt-1">
                    <Clock className="h-4 w-4 text-primary shrink-0" />
                    <span>
                      {formatSlotDateTimeRangeIST(nextAppointment.availability.startTime, nextAppointment.availability.endTime)}
                    </span>
                  </div>

                  {nextAppointment.reason && (
                    <p className="text-xs text-muted-foreground border-t border-primary/10 pt-2">
                      <strong className="text-foreground">Reason:</strong> {nextAppointment.reason}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-8 text-center space-y-3 bg-muted/20">
                  <div className="h-10 w-10 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      No Scheduled Appointments
                    </h3>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                      You do not have any upcoming doctor appointments. Browse specialists and select an available time slot.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </div>

          <div className="p-6 pt-0 border-t border-border mt-6 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Looking for care?</span>
            <Link
              href="/doctors"
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              Find a Doctor <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
