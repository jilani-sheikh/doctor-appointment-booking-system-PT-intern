import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role, DoctorStatus, AppointmentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Shield,
  Stethoscope,
  Users,
  Calendar,
} from "lucide-react";
import { formatDateTimeIST } from "@/lib/time";

export const metadata: Metadata = {
  title: "Admin Dashboard — Medrella",
  description: "Platform administration and verification control center.",
};

export default async function AdminDashboardPage() {
  const user = await requireRole(Role.ADMIN);

  // Aggregate counts
  const [
    totalUsers,
    patientUsers,
    doctorUsers,
    adminUsers,
    pendingDoctors,
    approvedDoctors,
    rejectedDoctors,
    pendingAppointments,
    confirmedAppointments,
    completedAppointments,
    cancelledAppointments,
    noShowAppointments,
    recentUsers,
    recentAppointments,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: Role.PATIENT } }),
    db.user.count({ where: { role: Role.DOCTOR } }),
    db.user.count({ where: { role: Role.ADMIN } }),
    db.doctor.count({ where: { status: DoctorStatus.PENDING } }),
    db.doctor.count({ where: { status: DoctorStatus.APPROVED } }),
    db.doctor.count({ where: { status: DoctorStatus.REJECTED } }),
    db.appointment.count({ where: { status: AppointmentStatus.PENDING } }),
    db.appointment.count({ where: { status: AppointmentStatus.CONFIRMED } }),
    db.appointment.count({ where: { status: AppointmentStatus.COMPLETED } }),
    db.appointment.count({ where: { status: AppointmentStatus.CANCELLED } }),
    db.appointment.count({ where: { status: AppointmentStatus.NO_SHOW } }),
    db.user.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    }),
    db.appointment.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        patient: {
          include: {
            user: { select: { name: true } },
          },
        },
        availability: {
          include: {
            doctor: {
              include: {
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const getRoleBadge = (role: Role | null) => {
    switch (role) {
      case "PATIENT":
        return <Badge variant="secondary" className="text-[10px] uppercase">Patient</Badge>;
      case "DOCTOR":
        return <Badge variant="default" className="text-[10px] uppercase bg-blue-600">Doctor</Badge>;
      case "ADMIN":
        return <Badge variant="default" className="text-[10px] uppercase bg-purple-600">Admin</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] uppercase">Unassigned</Badge>;
    }
  };

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="warning" className="text-[10px] uppercase">Pending</Badge>;
      case "CONFIRMED":
        return <Badge variant="success" className="text-[10px] uppercase">Confirmed</Badge>;
      case "COMPLETED":
        return <Badge variant="default" className="text-[10px] uppercase bg-emerald-600">Completed</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive" className="text-[10px] uppercase">Cancelled</Badge>;
      case "NO_SHOW":
        return <Badge variant="destructive" className="text-[10px] uppercase bg-rose-700">No Show</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] uppercase">{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" /> Administrative Console
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            System Overview — {user.name ?? "Administrator"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Platform health, user distribution, and appointment lifecycle metrics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/doctors"
            className={buttonVariants({ className: "gap-1.5 shadow-xs" })}
          >
            <Stethoscope className="h-4 w-4" />
            Doctor Verifications ({pendingDoctors})
          </Link>
          <SignOutButton
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          />
        </div>
      </div>

      {/* Aggregate Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* User Distribution */}
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Users by Role ({totalUsers})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Patients:</span>
              <span className="font-semibold text-foreground">{patientUsers}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Doctors:</span>
              <span className="font-semibold text-foreground">{doctorUsers}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Administrators:</span>
              <span className="font-semibold text-foreground">{adminUsers}</span>
            </div>
            <div className="flex justify-between py-1 text-muted-foreground">
              <span>Unassigned/New:</span>
              <span className="font-medium">{totalUsers - (patientUsers + doctorUsers + adminUsers)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Doctor Verification Status */}
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-primary" />
                Doctors by Status
              </CardTitle>
              <Link href="/admin/doctors" className="text-xs text-primary font-medium hover:underline">
                Manage →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-amber-600 dark:text-amber-400 font-medium">Pending Review:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">{pendingDoctors}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">Approved:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{approvedDoctors}</span>
            </div>
            <div className="flex justify-between py-1 text-destructive">
              <span className="font-medium">Rejected:</span>
              <span className="font-bold">{rejectedDoctors}</span>
            </div>
          </CardContent>
        </Card>

        {/* Appointments by Status */}
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Appointments by Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Pending:</span>
              <span className="font-medium text-amber-600">{pendingAppointments}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Confirmed:</span>
              <span className="font-medium text-emerald-600">{confirmedAppointments}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Completed:</span>
              <span className="font-medium text-foreground">{completedAppointments}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Cancelled:</span>
              <span className="font-medium text-muted-foreground">{cancelledAppointments}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">No Show:</span>
              <span className="font-medium text-rose-600">{noShowAppointments}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Read-Only Recent Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Users Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">Recent Users</h2>
            <span className="text-xs text-muted-foreground">Latest 20</span>
          </div>
          <Card className="border-border shadow-xs overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs font-semibold">User</TableHead>
                  <TableHead className="text-xs font-semibold">Role</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentUsers.map((u) => (
                  <TableRow key={u.id} className="text-xs">
                    <TableCell>
                      <span className="font-semibold text-foreground block">{u.name ?? "User"}</span>
                      <span className="text-[11px] text-muted-foreground">{u.email}</span>
                    </TableCell>
                    <TableCell>{getRoleBadge(u.role)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatDateTimeIST(u.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        {/* Recent Appointments Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">Recent Appointments</h2>
            <span className="text-xs text-muted-foreground">Latest 20</span>
          </div>
          <Card className="border-border shadow-xs overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs font-semibold">Consultation</TableHead>
                  <TableHead className="text-xs font-semibold">Slot Time</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentAppointments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground text-xs">
                      No appointments created yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentAppointments.map((a) => (
                    <TableRow key={a.id} className="text-xs">
                      <TableCell>
                        <span className="font-semibold text-foreground block">
                          Patient: {a.patient.user.name ?? "Patient"}
                        </span>
                        <span className="text-[11px] text-primary">
                          Dr. {a.availability.doctor.user.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTimeIST(a.availability.startTime)}
                      </TableCell>
                      <TableCell className="text-right">{getStatusBadge(a.status)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
