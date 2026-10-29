import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role, DoctorStatus, AppointmentStatus, WaveStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Stethoscope,
  Calendar,
  ShieldCheck,
  Waves,
  ArrowRight,
} from "lucide-react";
import { formatDateTimeIST } from "@/lib/time";
import { calculateWaveMetrics, type WaveTarget } from "@/lib/waves";

export const metadata: Metadata = {
  title: "Admin Dashboard — Medrella",
  description: "Administrative oversight, practitioner verifications, system metrics, and arrival wave monitoring.",
};

export default async function AdminDashboardPage() {
  await requireRole(Role.ADMIN);

  const [
    totalUsers,
    patientCount,
    doctorCount,
    adminCount,
    pendingDoctors,
    approvedDoctors,
    rejectedDoctors,
    pendingAppointments,
    confirmedAppointments,
    checkedInAppointments,
    inConsultationAppointments,
    completedAppointments,
    cancelledAppointments,
    noShowAppointments,
    publishedWaves,
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
    db.appointment.count({ where: { status: AppointmentStatus.CHECKED_IN } }),
    db.appointment.count({ where: { status: AppointmentStatus.IN_CONSULTATION } }),
    db.appointment.count({ where: { status: AppointmentStatus.COMPLETED } }),
    db.appointment.count({ where: { status: AppointmentStatus.CANCELLED } }),
    db.appointment.count({ where: { status: AppointmentStatus.NO_SHOW } }),
    db.wave.findMany({
      where: { status: WaveStatus.PUBLISHED },
      include: {
        appointments: { select: { status: true, checkedInAt: true } },
      },
    }),
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

  // Calculate aggregate wave performance metrics (Amendment 5a)
  let totalWaveExpected = 0;
  let totalWaveOnTime = 0;
  let totalWaveLate = 0;
  let totalWaveNoShow = 0;
  let totalWaveNotYetArrived = 0;

  for (const wave of publishedWaves) {
    const target: WaveTarget = {
      id: wave.id,
      specialization: wave.specialization,
      windowStart: wave.windowStart,
      windowEnd: wave.windowEnd,
      capacity: wave.capacity,
      stream: wave.stream,
      status: wave.status,
    };
    const m = calculateWaveMetrics(target, wave.appointments);
    totalWaveExpected += m.expectedArrivals;
    totalWaveOnTime += m.onTimeCheckIns;
    totalWaveLate += m.lateCheckIns;
    totalWaveNoShow += m.noShows;
    totalWaveNotYetArrived += m.notYetArrived;
  }

  const getRoleBadge = (role: Role | null) => {
    switch (role) {
      case "PATIENT":
        return <Badge variant="secondary" className="text-[10px] uppercase font-semibold">Patient</Badge>;
      case "DOCTOR":
        return <Badge variant="default" className="text-[10px] uppercase bg-blue-600 font-semibold">Doctor</Badge>;
      case "ADMIN":
        return <Badge variant="default" className="text-[10px] uppercase bg-purple-600 font-semibold">Admin</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] uppercase">Unassigned</Badge>;
    }
  };

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="warning" className="text-[10px] uppercase font-semibold">Pending</Badge>;
      case "CONFIRMED":
        return <Badge variant="success" className="text-[10px] uppercase font-semibold">Confirmed</Badge>;
      case "CHECKED_IN":
        return <Badge variant="warning" className="text-[10px] uppercase bg-amber-600 text-white font-semibold">Checked In</Badge>;
      case "IN_CONSULTATION":
        return <Badge variant="default" className="text-[10px] uppercase bg-blue-600 animate-pulse font-semibold">In Consultation</Badge>;
      case "COMPLETED":
        return <Badge variant="default" className="text-[10px] uppercase bg-emerald-600 font-semibold">Completed</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive" className="text-[10px] uppercase font-semibold">Cancelled</Badge>;
      case "NO_SHOW":
        return <Badge variant="destructive" className="text-[10px] uppercase bg-rose-700 font-semibold">No Show</Badge>;
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
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300 uppercase tracking-wider">
              System Administration
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            Admin Overview & Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor platform activity, practitioner verifications, wave arrivals, and system state.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/admin/waves"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Waves className="h-4 w-4 mr-1.5" />
            Arrival Waves
          </Link>
          <Link
            href="/admin/doctors"
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            Doctor Verifications
            {pendingDoctors > 0 && (
              <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                {pendingDoctors}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Wave Performance Summary Strip (Amendment 5a) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Waves className="h-4 w-4 text-primary" />
            Published Arrival Waves — Expected vs. Actual Arrivals
          </h2>
          <Link
            href="/admin/waves"
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            Manage Waves ({publishedWaves.length} published) <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">Expected Arrivals</span>
              <div className="text-2xl font-bold text-foreground mt-1">{totalWaveExpected}</div>
              <span className="text-[10px] text-muted-foreground">Assigned to waves</span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">On-Time Arrivals</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{totalWaveOnTime}</div>
              <span className="text-[10px] text-muted-foreground">Within wave window</span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">Late Check-Ins</span>
              <div className="text-2xl font-bold text-rose-600 mt-1">{totalWaveLate}</div>
              <span className="text-[10px] text-muted-foreground">Past window end</span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">No-Shows</span>
              <div className="text-2xl font-bold text-amber-600 mt-1">{totalWaveNoShow}</div>
              <span className="text-[10px] text-muted-foreground">Recorded absent</span>
            </CardContent>
          </Card>
          <Card className="col-span-2 sm:col-span-1 border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">Not Yet Arrived</span>
              <div className="text-2xl font-bold text-blue-600 mt-1">{totalWaveNotYetArrived}</div>
              <span className="text-[10px] text-muted-foreground">Awaiting check-in</span>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Metric Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* User Distribution */}
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              User Directory Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Total Users:</span>
              <span className="font-bold text-foreground">{totalUsers}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Patients:</span>
              <span className="font-semibold text-foreground">{patientCount}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Doctors:</span>
              <span className="font-semibold text-foreground">{doctorCount}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Administrators:</span>
              <span className="font-semibold text-foreground">{adminCount}</span>
            </div>
          </CardContent>
        </Card>

        {/* Doctor Verification Status */}
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-primary" />
              Doctor Verification Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-border/50 text-amber-600 dark:text-amber-400">
              <span className="font-medium">Pending Approvals:</span>
              <span className="font-bold">{pendingDoctors}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50 text-emerald-600 dark:text-emerald-400">
              <span className="font-medium">Approved Practitioners:</span>
              <span className="font-bold">{approvedDoctors}</span>
            </div>
            <div className="flex justify-between py-1 text-destructive">
              <span className="font-medium">Rejected Submissions:</span>
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
              <span className="text-muted-foreground">Checked In:</span>
              <span className="font-medium text-amber-700">{checkedInAppointments}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">In Consultation:</span>
              <span className="font-medium text-blue-600">{inConsultationAppointments}</span>
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

      {/* Recent Tables */}
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
