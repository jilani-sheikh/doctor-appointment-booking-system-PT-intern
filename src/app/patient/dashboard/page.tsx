import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Calendar, User, Clock, Stethoscope, ArrowRight } from "lucide-react";
import { formatDateIST } from "@/lib/time";

export const metadata: Metadata = {
  title: "Patient Dashboard — Medrella",
  description: "View upcoming appointments and manage your consultations.",
};

export default async function PatientDashboardPage() {
  const user = await requireRole(Role.PATIENT);
  const patient = user.patient;

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
            Manage your medical appointments, consultations, and profile details.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/book"
            className={buttonVariants({ variant: "default", className: "shadow-sm flex items-center" })}
          >
            <Calendar className="h-4 w-4 mr-2" />
            Book Appointment
          </Link>
          <Link
            href="/doctors"
            className={buttonVariants({ variant: "outline", className: "flex items-center" })}
          >
            <Stethoscope className="h-4 w-4 mr-2" />
            Find Doctors
          </Link>
        </div>
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

        {/* Appointments Placeholder */}
        <Card className="md:col-span-2 shadow-sm border-border bg-card flex flex-col justify-between">
          <div>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Upcoming Appointments
                </CardTitle>
                <span className="text-[11px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded">
                  Coming soon (Phase 5)
                </span>
              </div>
              <CardDescription className="text-xs">
                Your upcoming confirmed consultations with doctors
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-dashed border-border p-8 text-center space-y-3 bg-muted/20">
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Appointment Booking Lifecycle Coming in Phase 5
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                    Direct slot selection, appointment confirmations, and cancellation management
                    will be available in Phase 5.
                  </p>
                </div>
              </div>
            </CardContent>
          </div>
          <div className="p-6 pt-0 border-t border-border mt-6 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Need medical care today?</span>
            <Link
              href="/doctors"
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              Browse Available Doctors <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
