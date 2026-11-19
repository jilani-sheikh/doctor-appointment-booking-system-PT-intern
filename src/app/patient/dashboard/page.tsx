import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role, AppointmentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Calendar, User, Clock, ArrowRight, Activity, AlertCircle, ClipboardList, Pill, AlertTriangle } from "lucide-react";
import { formatDateIST, formatTimeIST, formatSlotRange, formatSlotDateTimeRangeIST, getTodayISTDateString, getISTDateString } from "@/lib/time";
import {
  effectiveSlot,
  isEligibleForDisruptedDashboardAlternatives,
  type ThreeLevelAlternativeSuggestions,
} from "@/lib/scheduling";
import { discoverAlternativeAppointmentsForPatient } from "@/lib/actions/reschedule";
import { DisruptedAlternativeSelector } from "@/components/patient/disrupted-alternative-selector";
import { calculateSubSlotQueues, EMERGENCY_DISCLAIMER, type SubSlotQueueItem } from "@/lib/queue";
import { buildSubSlotQueueScopeKey, formatDoctorDisplayName, formatSubSlotLabel } from "@/lib/queue-tokens";
import { formatWaveArrivalWindowIST } from "@/lib/waves";
import { DeleteProfileDialog } from "@/components/auth/delete-profile-dialog";
import { LiveQueueRefresh } from "@/components/patient/live-queue-refresh";

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

  // Query appointments for counts and active appointments + lightweight medical summary
  const [
    allAppointments,
    allergyCount,
    severeAllergyCount,
    ongoingConditionCount,
    medicationCount,
    recentPrescriptions,
    totalPrescriptionCount,
  ] = await Promise.all([
    db.appointment.findMany({
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
    }),
    db.patientAllergy.count({ where: { patientId: patient.id } }),
    db.patientAllergy.count({ where: { patientId: patient.id, severity: "SEVERE" } }),
    db.patientCondition.count({ where: { patientId: patient.id, status: "ONGOING" } }),
    db.patientMedication.count({ where: { patientId: patient.id } }),
    db.prescription.findMany({
      where: { patientId: patient.id },
      select: {
        id: true,
        diagnosis: true,
        doctorNameSnapshot: true,
        prescribedAt: true,
        _count: { select: { medicines: true } },
      },
      orderBy: { prescribedAt: "desc" },
      take: 3,
    }),
    db.prescription.count({ where: { patientId: patient.id } }),
  ]);

  const upcomingAppts = allAppointments.filter((a) => {
    const isFutureOrToday =
      effectiveSlot(a).start >= now ||
      getISTDateString(effectiveSlot(a).start) === todayISTStr;
    const isActive =
      a.status === AppointmentStatus.PENDING ||
      a.status === AppointmentStatus.CONFIRMED ||
      a.status === AppointmentStatus.CHECKED_IN ||
      a.status === AppointmentStatus.CALLED ||
      a.status === AppointmentStatus.IN_CONSULTATION;
    return isFutureOrToday && isActive;
  });

  const pastApptsCount = allAppointments.length - upcomingAppts.length;
  const nextAppointment = upcomingAppts[0] ?? null;

  // Discover recommended alternatives for any disrupted upcoming appointments pending rescheduling
  const disruptedUpcomingAppts = upcomingAppts.filter((a) =>
    isEligibleForDisruptedDashboardAlternatives(
      {
        status: a.status,
        startTime: effectiveSlot(a).start,
        disruptedAt: a.disruptedAt,
        rescheduleStatus: a.rescheduleStatus,
      },
      now
    )
  );

  const suggestedAlternativesByApptId = new Map<string, ThreeLevelAlternativeSuggestions>();
  await Promise.all(
    disruptedUpcomingAppts.map(async (appt) => {
      const suggestions = await discoverAlternativeAppointmentsForPatient(appt.id, now);
      if (suggestions) {
        suggestedAlternativesByApptId.set(appt.id, suggestions);
      }
    })
  );

  const additionalDisruptedAppts = disruptedUpcomingAppts.filter(
    (a) => a.id !== nextAppointment?.id
  );

  // Find active appointment for today (if any)
  const todayActiveAppt = upcomingAppts.find(
    (a) => getISTDateString(effectiveSlot(a).start) === todayISTStr
  );

  let todayQueueEstimate = null;
  if (todayActiveAppt) {
    const siblingAppts = await db.appointment.findMany({
      where: {
        availabilityId: todayActiveAppt.availabilityId,
        status: { not: AppointmentStatus.PENDING_PAYMENT },
      },
      select: {
        id: true,
        availabilityId: true,
        queueScopeKey: true,
        tokenNumber: true,
        status: true,
        slotStart: true,
        slotEnd: true,
        actualStartAt: true,
        actualEndAt: true,
        checkedInAt: true,
        calledAt: true,
        createdAt: true,
        availability: {
          select: {
            doctorId: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    const todaySubSlotAppts = siblingAppts.filter(
      (a) => getISTDateString(effectiveSlot(a).start) === todayISTStr
    );

    const queueItems: SubSlotQueueItem[] = todaySubSlotAppts.map((a) => ({
      id: a.id,
      status: a.status,
      scheduledStart: effectiveSlot(a).start,
      scheduledEnd: effectiveSlot(a).end,
      actualStartAt: a.actualStartAt,
      actualEndAt: a.actualEndAt,
      checkedInAt: a.checkedInAt,
      calledAt: a.calledAt,
      tokenNumber: a.tokenNumber,
      createdAt: a.createdAt,
      queueScopeKey:
        a.queueScopeKey ??
        buildSubSlotQueueScopeKey({
          doctorId: a.availability.doctorId,
          startTime: a.availability.startTime,
          availabilityId: a.availabilityId,
        }),
    }));

    const { estimates } = calculateSubSlotQueues(queueItems, now);
    todayQueueEstimate = estimates.get(todayActiveAppt.id) ?? null;
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-8">
      {todayActiveAppt && <LiveQueueRefresh intervalMs={15000} />}
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
        <div className="flex items-center gap-3 flex-wrap">
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
          <Link
            href="/patient/medical-records"
            className={buttonVariants({ variant: "outline", className: "flex items-center" })}
          >
            <ClipboardList className="h-4 w-4 mr-2" />
            Medical Records
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
                    Scheduled: {formatSlotRange(effectiveSlot(todayActiveAppt).start, effectiveSlot(todayActiveAppt).end)}
                  </span>
                  <span>•</span>
                  <span className="font-medium text-primary/90">
                    {formatSubSlotLabel({
                      kind: todayActiveAppt.availability.kind,
                      availabilityStart: todayActiveAppt.availability.startTime,
                      availabilityEnd: todayActiveAppt.availability.endTime,
                      slotStart: todayActiveAppt.slotStart,
                      slotEnd: todayActiveAppt.slotEnd,
                    })}
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

              <div className="flex items-center gap-2 flex-wrap">
                {typeof todayActiveAppt.tokenNumber === "number" && (
                  <Badge className="bg-primary text-primary-foreground text-xs font-bold">
                    Token #{todayActiveAppt.tokenNumber}
                  </Badge>
                )}
                <Badge
                  variant={
                    todayActiveAppt.status === "CHECKED_IN"
                      ? "warning"
                      : todayActiveAppt.status === "CALLED" || todayActiveAppt.status === "IN_CONSULTATION"
                      ? "default"
                      : "success"
                  }
                  className={`text-xs uppercase font-semibold ${
                    todayActiveAppt.status === "CALLED" ? "bg-indigo-600 text-white animate-pulse" : ""
                  }`}
                >
                  {todayActiveAppt.status === "CHECKED_IN"
                    ? "Arrived / Waiting"
                    : todayActiveAppt.status === "CALLED"
                    ? "Called — Proceed Now"
                    : todayActiveAppt.status === "IN_CONSULTATION"
                    ? "In Consultation"
                    : todayActiveAppt.status}
                </Badge>
              </div>
            </div>

            {todayActiveAppt.status === "CALLED" && (
              <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-300 dark:border-indigo-700 text-xs text-indigo-950 dark:text-indigo-100 font-medium">
                You have been called by Reception Desk for Dr. {todayActiveAppt.availability.doctor.user.name}
                {typeof todayActiveAppt.tokenNumber === "number" ? ` (Token #${todayActiveAppt.tokenNumber})` : ""}. Please proceed to the consultation room.
              </div>
            )}

            {todayQueueEstimate && (
              <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-3 text-xs flex-wrap">
                <span className="font-semibold text-foreground">
                  {typeof todayActiveAppt.tokenNumber === "number"
                    ? `Token #${todayActiveAppt.tokenNumber}`
                    : "Token Pending"}
                </span>
                <span>•</span>
                <span className="font-semibold text-foreground">
                  {todayActiveAppt.status === "CALLED"
                    ? "Called for consultation"
                    : `Queue Position: #${todayQueueEstimate.queuePosition}`}
                </span>
                <span>•</span>
                <span>
                  Status: <strong className="text-foreground">{todayActiveAppt.status}</strong>
                </span>
                {todayActiveAppt.checkedInAt && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                      Checked In at {formatTimeIST(todayActiveAppt.checkedInAt)}
                    </span>
                  </>
                )}
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
            <div className="pt-2 border-t border-border">
              <DeleteProfileDialog email={user.email} />
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
            <CardContent className="space-y-4">
              {nextAppointment ? (
                <>
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span className="text-lg font-bold text-foreground">
                          Dr. {nextAppointment.availability.doctor.user.name ?? "Doctor"}
                        </span>
                        <p className="text-xs text-primary font-medium">
                          {nextAppointment.availability.doctor.specialization}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {typeof nextAppointment.tokenNumber === "number" && (
                          <Badge className="bg-primary text-primary-foreground text-[10px] font-bold">
                            Token #{nextAppointment.tokenNumber}
                          </Badge>
                        )}
                        <Badge
                          variant={nextAppointment.status === "CONFIRMED" ? "success" : "warning"}
                          className="text-[10px] uppercase"
                        >
                          {nextAppointment.status}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-foreground font-semibold pt-1">
                      <Clock className="h-4 w-4 text-primary shrink-0" />
                      <span>
                        {formatSlotDateTimeRangeIST(effectiveSlot(nextAppointment).start, effectiveSlot(nextAppointment).end)}
                      </span>
                    </div>

                    {nextAppointment.reason && (
                      <p className="text-xs text-muted-foreground border-t border-primary/10 pt-2">
                        <strong className="text-foreground">Reason:</strong> {nextAppointment.reason}
                      </p>
                    )}
                  </div>

                  {isEligibleForDisruptedDashboardAlternatives(
                    {
                      status: nextAppointment.status,
                      startTime: effectiveSlot(nextAppointment).start,
                      disruptedAt: nextAppointment.disruptedAt,
                      rescheduleStatus: nextAppointment.rescheduleStatus,
                    },
                    now
                  ) && (
                    <DisruptedAlternativeSelector
                      appointmentId={nextAppointment.id}
                      doctorName={nextAppointment.availability.doctor.user.name ?? "Doctor"}
                      specialization={nextAppointment.availability.doctor.specialization}
                      originalSlotStart={effectiveSlot(nextAppointment).start}
                      originalSlotEnd={effectiveSlot(nextAppointment).end}
                      disruptionReason={nextAppointment.disruptionReason}
                      suggestedAlternatives={
                        suggestedAlternativesByApptId.get(nextAppointment.id) ?? null
                      }
                    />
                  )}

                  {additionalDisruptedAppts.map((disruptedAppt) => (
                    <DisruptedAlternativeSelector
                      key={disruptedAppt.id}
                      appointmentId={disruptedAppt.id}
                      doctorName={disruptedAppt.availability.doctor.user.name ?? "Doctor"}
                      specialization={disruptedAppt.availability.doctor.specialization}
                      originalSlotStart={effectiveSlot(disruptedAppt).start}
                      originalSlotEnd={effectiveSlot(disruptedAppt).end}
                      disruptionReason={disruptedAppt.disruptionReason}
                      suggestedAlternatives={
                        suggestedAlternativesByApptId.get(disruptedAppt.id) ?? null
                      }
                    />
                  ))}
                </>
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

      {/* Medical Profile & Prescriptions Summary Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                My Medical History
              </CardTitle>
              <Link
                href="/patient/medical-records"
                className="text-xs font-semibold text-primary hover:underline"
              >
                Manage Records &rarr;
              </Link>
            </div>
            <CardDescription className="text-xs">
              Allergies, ongoing conditions, current medications, and past history
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-border/70 p-2.5">
                <p className="text-lg font-bold text-foreground">{allergyCount}</p>
                <p className="text-[11px] text-muted-foreground">Allergies</p>
              </div>
              <div className="rounded-lg border border-border/70 p-2.5">
                <p className="text-lg font-bold text-foreground">{ongoingConditionCount}</p>
                <p className="text-[11px] text-muted-foreground">Ongoing Conditions</p>
              </div>
              <div className="rounded-lg border border-border/70 p-2.5">
                <p className="text-lg font-bold text-foreground">{medicationCount}</p>
                <p className="text-[11px] text-muted-foreground">Medications</p>
              </div>
            </div>
            {severeAllergyCount > 0 && (
              <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-500/30 px-3 py-2 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                {severeAllergyCount} severe allergy alert(s) active on your profile.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Pill className="h-4 w-4 text-emerald-600" />
                Recent Prescriptions ({totalPrescriptionCount})
              </CardTitle>
              <Link
                href="/patient/medical-records?tab=prescriptions"
                className="text-xs font-semibold text-primary hover:underline"
              >
                View All &rarr;
              </Link>
            </div>
            <CardDescription className="text-xs">
              Latest prescriptions issued by your doctors in Medrella
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentPrescriptions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                No prescriptions issued yet.
              </p>
            ) : (
              recentPrescriptions.map((rx) => (
                <Link
                  key={rx.id}
                  href={`/patient/prescriptions/${rx.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-2.5 hover:border-primary/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">
                      {rx.diagnosis}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {formatDoctorDisplayName(rx.doctorNameSnapshot)} • {formatDateIST(rx.prescribedAt)} • {rx._count.medicines} medicine(s)
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    Open Rx
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
