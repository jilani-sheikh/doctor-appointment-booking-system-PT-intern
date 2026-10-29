import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role, DoctorStatus, AppointmentStatus, SlotStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Clock, Calendar, Stethoscope, Briefcase, Users, ArrowRight, Activity } from "lucide-react";
import { getTodayISTDateString, getISTDateString } from "@/lib/time";

export const metadata: Metadata = {
  title: "Doctor Dashboard — Medrella",
  description: "Manage your doctor profile, availability slots, and patient consultations.",
};

export default async function DoctorDashboardPage() {
  const user = await requireRole(Role.DOCTOR);
  const doctor = user.doctor;

  const isPendingApproval = doctor?.status === DoctorStatus.PENDING;
  const isRejected = doctor?.status === DoctorStatus.REJECTED;
  const isApproved = doctor?.status === DoctorStatus.APPROVED;

  let todayAppointmentsCount = 0;
  let upcomingTotalCount = 0;
  let openSlotsCount = 0;

  if (isApproved && doctor) {
    const now = new Date();
    const todayIST = getTodayISTDateString();

    const [allDoctorAppts, availableSlots] = await Promise.all([
      db.appointment.findMany({
        where: {
          availability: {
            doctorId: doctor.id,
          },
        },
        include: {
          availability: {
            select: {
              startTime: true,
            },
          },
        },
      }),
      db.availability.count({
        where: {
          doctorId: doctor.id,
          startTime: { gte: now },
          status: SlotStatus.AVAILABLE,
        },
      }),
    ]);

    openSlotsCount = availableSlots;

    for (const appt of allDoctorAppts) {
      const slotDateIST = getISTDateString(appt.availability.startTime);
      if (
        slotDateIST === todayIST &&
        appt.status !== AppointmentStatus.CANCELLED &&
        appt.status !== AppointmentStatus.NO_SHOW
      ) {
        todayAppointmentsCount++;
      }

      if (
        appt.availability.startTime >= now &&
        (appt.status === AppointmentStatus.PENDING ||
          appt.status === AppointmentStatus.CONFIRMED ||
          appt.status === AppointmentStatus.CHECKED_IN ||
          appt.status === AppointmentStatus.IN_CONSULTATION)
      ) {
        upcomingTotalCount++;
      }
    }
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      {/* Status Banners */}
      {isPendingApproval && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 shadow-sm">
          <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-semibold text-sm text-amber-900">
              Profile Awaiting Administrative Verification
            </h4>
            <p className="text-xs text-amber-800 leading-relaxed">
              Your doctor profile has been submitted and is currently pending verification. While in
              pending status, patients cannot book consultations with you. Administrators can verify your
              credentials in the Admin Portal.
            </p>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive shadow-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">Doctor Application Notice</h4>
            <p className="text-xs leading-relaxed opacity-90">
              Your profile verification was not approved. Please reach out to administrative support
              to review your medical credentials.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider">
              Doctor Portal
            </span>
            {isApproved && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Verified Doctor
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            Dr. {user.name ?? "Practitioner"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {doctor?.specialization} • {doctor?.qualification ?? "Medical Practitioner"}
          </p>
        </div>

        {isApproved && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <Link
              href="/doctor/queue"
              className={buttonVariants({ variant: "default", size: "sm", className: "gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold" })}
            >
              <Activity className="h-4 w-4" />
              Live Queue
            </Link>
            <Link
              href="/doctor/time-off"
              className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1.5" })}
            >
              Time Off
            </Link>
            <Link
              href="/doctor/slots"
              className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1.5" })}
            >
              <Calendar className="h-4 w-4" />
              Slots
            </Link>
            <Link
              href="/doctor/appointments"
              className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1.5" })}
            >
              <Users className="h-4 w-4" />
              Consultations
            </Link>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      {isApproved && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border shadow-xs">
            <CardHeader className="py-3 px-4">
              <CardDescription className="text-xs">Today&apos;s Appointments</CardDescription>
              <CardTitle className="text-2xl font-bold text-foreground">
                {todayAppointmentsCount}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-border shadow-xs">
            <CardHeader className="py-3 px-4">
              <CardDescription className="text-xs">Upcoming Total</CardDescription>
              <CardTitle className="text-2xl font-bold text-foreground">
                {upcomingTotalCount}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-border shadow-xs">
            <CardHeader className="py-3 px-4">
              <CardDescription className="text-xs">Open Slots</CardDescription>
              <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {openSlotsCount}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Practice Overview Card */}
        <Card className="shadow-sm border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-primary" />
              Practice Details
            </CardTitle>
            <CardDescription className="text-xs">Your clinical profile summary</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Specialization</p>
              <p className="font-medium text-foreground">{doctor?.specialization ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Qualification</p>
              <p className="font-medium text-foreground">{doctor?.qualification ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Consultation Fee</p>
              <p className="font-medium text-foreground">
                ₹{doctor?.consultationFee ? Number(doctor.consultationFee).toLocaleString("en-IN") : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Experience</p>
              <p className="font-medium text-foreground">
                {doctor?.experienceYears ? `${doctor.experienceYears} Years` : "—"}
              </p>
            </div>
            {doctor?.bio && (
              <div>
                <p className="text-xs text-muted-foreground">Clinical Bio</p>
                <p className="text-xs text-foreground/80 mt-0.5 leading-relaxed">{doctor.bio}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Slot Management Card */}
        <Card className="md:col-span-2 shadow-sm border-border bg-card flex flex-col justify-between">
          <div>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  Availability & Consultations
                </CardTitle>
                {isApproved && (
                  <Link
                    href="/doctor/slots"
                    className={buttonVariants({ size: "sm", variant: "default" })}
                  >
                    Manage Slots
                  </Link>
                )}
              </div>
              <CardDescription className="text-xs">
                Manage your weekly consultation hours and upcoming patient bookings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border p-6 text-center space-y-3 bg-muted/10">
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center">
                  <Briefcase className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Doctor Slot & Consultation Workflow
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                    Bulk-generate consultation slots, manage cancellations, and track patient consultations.
                  </p>
                </div>
                {isApproved && (
                  <div className="flex justify-center gap-3 pt-2">
                    <Link
                      href="/doctor/slots"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Open Slot Manager →
                    </Link>
                    <Link
                      href="/doctor/appointments"
                      className={buttonVariants({ variant: "default", size: "sm" })}
                    >
                      View Appointments →
                    </Link>
                  </div>
                )}
              </div>
            </CardContent>
          </div>
          <div className="p-6 pt-0 border-t border-border mt-6 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Approval Status: <span className="font-semibold text-foreground">{doctor?.status}</span>
            </p>
            {isApproved && (
              <Link href="/doctor/appointments" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
                View Today&apos;s Schedule <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
