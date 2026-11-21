"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppointmentStatus } from "@/generated/prisma/enums";
import {
  receptionistCallNextPatientAction,
  receptionistMarkArrivedAction,
  receptionistMarkCompletedAction,
  receptionistMarkNotArrivedAction,
  receptionistStartConsultationAction,
} from "@/lib/actions/queue";
import {
  filterReceptionistAppointments,
  type ReceptionistDashboardData,
  type SerializedReceptionistAppointment,
  type SerializedReceptionistSubSlotQueue,
} from "@/lib/receptionist";
import { STREAM_CONFIGS } from "@/lib/streams";
import { formatDateIST, formatSlotRange, formatTimeIST } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Activity,
  BellRing,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Hash,
  Loader2,
  Megaphone,
  Phone,
  Play,
  RefreshCw,
  Search,
  Stethoscope,
  UserCheck,
  UserX,
  Users,
  Waves,
} from "lucide-react";

interface ReceptionistDashboardViewProps {
  data: ReceptionistDashboardData;
}

const PAGE_SIZE = 15;

function getAppointmentStatusBadge(status: AppointmentStatus) {
  switch (status) {
    case AppointmentStatus.CONFIRMED:
      return (
        <Badge variant="success" className="text-[10px] uppercase font-semibold">
          Waiting (Confirmed)
        </Badge>
      );
    case AppointmentStatus.CHECKED_IN:
      return (
        <Badge variant="warning" className="text-[10px] uppercase font-semibold">
          Checked In
        </Badge>
      );
    case AppointmentStatus.CALLED:
      return (
        <Badge
          variant="default"
          className="text-[10px] uppercase bg-indigo-600 text-white font-semibold animate-pulse"
        >
          Called
        </Badge>
      );
    case AppointmentStatus.IN_CONSULTATION:
      return (
        <Badge
          variant="default"
          className="text-[10px] uppercase bg-blue-600 text-white font-semibold animate-pulse"
        >
          In Consultation
        </Badge>
      );
    case AppointmentStatus.COMPLETED:
      return (
        <Badge
          variant="default"
          className="text-[10px] uppercase bg-emerald-600 font-semibold"
        >
          Completed
        </Badge>
      );
    case AppointmentStatus.CANCELLED:
      return (
        <Badge variant="destructive" className="text-[10px] uppercase font-semibold">
          Cancelled
        </Badge>
      );
    case AppointmentStatus.NO_SHOW:
      return (
        <Badge
          variant="destructive"
          className="text-[10px] uppercase bg-rose-700 font-semibold"
        >
          Not Arrived
        </Badge>
      );
    case AppointmentStatus.PENDING:
      return (
        <Badge variant="outline" className="text-[10px] uppercase font-semibold">
          Pending
        </Badge>
      );
    case AppointmentStatus.PENDING_PAYMENT:
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px] uppercase font-semibold">
          Hold - Payment Pending
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px] uppercase">
          {status}
        </Badge>
      );
  }
}

export function ReceptionistDashboardView({ data }: ReceptionistDashboardViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("ALL");
  const [subSlotFilter, setSubSlotFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "ALL">("ALL");
  const [checkInFilter, setCheckInFilter] = useState<
    "ALL" | "CHECKED_IN" | "NOT_CHECKED_IN"
  >("ALL");
  const [queueDoctorFilter, setQueueDoctorFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  // Auto-refresh every 12 seconds while tab is visible so Patient/Doctor views stay synced
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [router]);

  const allSubSlots = useMemo(() => {
    const map = new Map<string, SerializedReceptionistSubSlotQueue>();
    for (const dq of data.doctorQueues) {
      for (const ss of dq.subSlots) {
        map.set(ss.queueScopeKey, ss);
      }
    }
    return map;
  }, [data.doctorQueues]);

  const subSlotOptions = useMemo(() => {
    const seen = new Map<string, { scopeKey: string; label: string; startTime: string }>();
    for (const appt of data.appointments) {
      if (doctorFilter !== "ALL" && appt.doctorId !== doctorFilter) continue;
      if (appt.status === AppointmentStatus.PENDING_PAYMENT) continue;
      if (!seen.has(appt.queueScopeKey)) {
        seen.set(appt.queueScopeKey, {
          scopeKey: appt.queueScopeKey,
          label:
            doctorFilter === "ALL"
              ? `Dr. ${appt.doctorName} • ${appt.subSlotTimeLabel}`
              : appt.subSlotTimeLabel,
          startTime: appt.scheduledStart,
        });
      }
    }
    return Array.from(seen.values()).sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [data.appointments, doctorFilter]);

  const effectiveSubSlotFilter = useMemo(
    () =>
      subSlotOptions.some((opt) => opt.scopeKey === subSlotFilter)
        ? subSlotFilter
        : "ALL",
    [subSlotOptions, subSlotFilter]
  );

  const selectedSubSlotQueue: SerializedReceptionistSubSlotQueue | null = useMemo(() => {
    if (effectiveSubSlotFilter === "ALL") return null;
    const found = allSubSlots.get(effectiveSubSlotFilter) ?? null;
    if (found && doctorFilter !== "ALL" && found.doctorId !== doctorFilter) {
      return null;
    }
    return found;
  }, [allSubSlots, effectiveSubSlotFilter, doctorFilter]);

  const filteredAppointments = useMemo(
    () =>
      filterReceptionistAppointments(data.appointments, {
        search,
        doctorId: doctorFilter,
        subSlotScopeKey: effectiveSubSlotFilter,
        appointmentStatus: statusFilter,
        checkInStatus: checkInFilter,
      }),
    [data.appointments, search, doctorFilter, effectiveSubSlotFilter, statusFilter, checkInFilter]
  );

  const totalPages = Math.max(1, Math.ceil(filteredAppointments.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedAppointments = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredAppointments.slice(start, start + PAGE_SIZE);
  }, [filteredAppointments, safePage]);

  const visibleDoctorQueues = useMemo(() => {
    if (queueDoctorFilter === "ALL") return data.doctorQueues;
    return data.doctorQueues.filter((q) => q.doctorId === queueDoctorFilter);
  }, [data.doctorQueues, queueDoctorFilter]);

  const activeCalledOrConsultingAppointments = useMemo(
    () =>
      data.appointments.filter((a) => {
        if (doctorFilter !== "ALL" && a.doctorId !== doctorFilter) return false;
        return (
          a.status === AppointmentStatus.CALLED ||
          a.status === AppointmentStatus.IN_CONSULTATION
        );
      }),
    [data.appointments, doctorFilter]
  );

  const hasActiveFilters =
    search.trim().length > 0 ||
    doctorFilter !== "ALL" ||
    effectiveSubSlotFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    checkInFilter !== "ALL";

  const clearFilters = () => {
    setSearch("");
    setDoctorFilter("ALL");
    setSubSlotFilter("ALL");
    setStatusFilter("ALL");
    setCheckInFilter("ALL");
    setPage(1);
  };

  const handleDateChange = (nextDate: string) => {
    if (!nextDate) {
      router.push("/receptionist");
      return;
    }
    router.push(`/receptionist?date=${encodeURIComponent(nextDate)}`);
  };

  const scopeContextForAppt = (
    appt: SerializedReceptionistAppointment,
    useRowExactScope: boolean = false
  ) =>
    useRowExactScope
      ? {
          expectedDoctorId: appt.doctorId,
          expectedAvailabilityId: appt.availabilityId,
        }
      : {
          expectedDoctorId: doctorFilter !== "ALL" ? doctorFilter : appt.doctorId,
          expectedAvailabilityId:
            effectiveSubSlotFilter !== "ALL" && selectedSubSlotQueue
              ? selectedSubSlotQueue.availabilityId
              : appt.availabilityId,
        };

  const handleCheckIn = (
    appt: SerializedReceptionistAppointment,
    useRowExactScope: boolean = false
  ) => {
    if (activeActionId || isPending) return;
    setActiveActionId(appt.id);
    startTransition(async () => {
      try {
        const res = await receptionistMarkArrivedAction(
          appt.id,
          scopeContextForAppt(appt, useRowExactScope)
        );
        if (res.success) {
          toast.success(
            `${appt.patientName} checked in${
              appt.tokenNumber ? ` (Token #${appt.tokenNumber})` : ""
            }.`
          );
          router.refresh();
        } else {
          toast.error(res.error || "Unable to check in patient.");
          if (res.alreadyCheckedIn) {
            router.refresh();
          }
        }
      } catch {
        toast.error("Failed to record patient check-in.");
      } finally {
        setActiveActionId(null);
      }
    });
  };

  const handleCallNextPatient = (subSlot: SerializedReceptionistSubSlotQueue) => {
    if (activeActionId || isPending || !subSlot.canCallNext) return;
    setActiveActionId(`call:${subSlot.queueScopeKey}`);
    startTransition(async () => {
      try {
        const res = await receptionistCallNextPatientAction({
          doctorId: subSlot.doctorId,
          availabilityId: subSlot.availabilityId,
          queueScopeKey: subSlot.queueScopeKey,
        });
        if (res.success) {
          toast.success(res.message);
          router.refresh();
        } else {
          toast.error(res.error || "Unable to call next patient.");
        }
      } catch {
        toast.error("Failed to call next patient.");
      } finally {
        setActiveActionId(null);
      }
    });
  };

  const handleStartConsultation = (
    appt: SerializedReceptionistAppointment,
    useRowExactScope: boolean = false
  ) => {
    if (activeActionId || isPending) return;
    setActiveActionId(appt.id);
    startTransition(async () => {
      try {
        const res = await receptionistStartConsultationAction(
          appt.id,
          scopeContextForAppt(appt, useRowExactScope)
        );
        if (res.success) {
          toast.success(
            `Consultation started for ${appt.patientName} (${appt.tokenLabel}).`
          );
          router.refresh();
        } else {
          toast.error(res.error || "Unable to start consultation.");
        }
      } catch {
        toast.error("Failed to start consultation.");
      } finally {
        setActiveActionId(null);
      }
    });
  };

  const handleNotArrived = (
    appt: SerializedReceptionistAppointment,
    useRowExactScope: boolean = false
  ) => {
    if (activeActionId || isPending) return;
    if (!confirm(`Mark ${appt.patientName} (${appt.tokenLabel}) as Not Arrived?`)) {
      return;
    }
    setActiveActionId(appt.id);
    startTransition(async () => {
      try {
        const res = await receptionistMarkNotArrivedAction(
          appt.id,
          scopeContextForAppt(appt, useRowExactScope)
        );
        if (res.success) {
          toast.success(`${appt.patientName} marked as Not Arrived.`);
          router.refresh();
        } else {
          toast.error(res.error || "Unable to mark appointment as Not Arrived.");
        }
      } catch {
        toast.error("Failed to record Not Arrived status.");
      } finally {
        setActiveActionId(null);
      }
    });
  };

  const handleCompleted = (
    appt: SerializedReceptionistAppointment,
    useRowExactScope: boolean = false
  ) => {
    if (activeActionId || isPending) return;
    setActiveActionId(appt.id);
    startTransition(async () => {
      try {
        const res = await receptionistMarkCompletedAction(
          appt.id,
          scopeContextForAppt(appt, useRowExactScope)
        );
        if (res.success) {
          toast.success(
            `Consultation completed for ${appt.patientName} (${appt.tokenLabel}).`
          );
          router.refresh();
        } else {
          toast.error(res.error || "Unable to mark appointment as Completed.");
        }
      } catch {
        toast.error("Failed to record consultation completion.");
      } finally {
        setActiveActionId(null);
      }
    });
  };

  const renderRowActions = (
    appt: SerializedReceptionistAppointment,
    useRowExactScope: boolean = false
  ) => {
    const isRowSubmitting = activeActionId === appt.id;
    const anyButtons =
      appt.canCheckIn ||
      appt.canStartConsultation ||
      appt.canMarkCompleted ||
      appt.canShowNotArrivedAction;

    if (!anyButtons) {
      if (appt.status === AppointmentStatus.CHECKED_IN) {
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready to Call
          </span>
        );
      }
      return <span className="text-[11px] text-muted-foreground">—</span>;
    }

    return (
      <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
        {appt.canCheckIn && (
          <Button
            type="button"
            size="xs"
            disabled={isPending || Boolean(activeActionId)}
            onClick={() => handleCheckIn(appt, useRowExactScope)}
            className="gap-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
          >
            {isRowSubmitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <UserCheck className="h-3 w-3" />
            )}
            Check In
          </Button>
        )}

        {appt.canStartConsultation && (
          <Button
            type="button"
            size="xs"
            disabled={isPending || Boolean(activeActionId)}
            onClick={() => handleStartConsultation(appt, useRowExactScope)}
            className="gap-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
          >
            {isRowSubmitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Start Consultation
          </Button>
        )}

        {appt.canMarkCompleted && (
          <Button
            type="button"
            size="xs"
            disabled={isPending || Boolean(activeActionId)}
            onClick={() => handleCompleted(appt, useRowExactScope)}
            className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          >
            {isRowSubmitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            Completed
          </Button>
        )}

        {appt.canShowNotArrivedAction && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={isPending || Boolean(activeActionId) || !appt.canMarkNotArrived}
            title={
              appt.notArrivedDisabledReason ??
              "Mark patient as Not Arrived (No-Show)"
            }
            onClick={() => handleNotArrived(appt, useRowExactScope)}
            className="gap-1 text-rose-600 border-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/20 font-semibold"
          >
            {isRowSubmitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <UserX className="h-3 w-3" />
            )}
            Not Arrived
          </Button>
        )}
      </div>
    );
  };

  const selectedDateDisplay = formatDateIST(
    new Date(`${data.selectedDateIST}T06:00:00Z`)
  );

  return (
    <div className="space-y-6">
      {/* Date Navigation & Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <span>
              Clinic Date (IST):{" "}
              <strong className="text-foreground">{selectedDateDisplay}</strong>
            </span>
          </div>
          <Input
            type="date"
            aria-label="Select clinic date"
            value={data.selectedDateIST}
            onChange={(e) => handleDateChange(e.target.value)}
            className="h-8 w-40 text-xs"
          />
          {!data.isSelectedDateToday && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => router.push("/receptionist")}
            >
              Jump to Today
            </Button>
          )}
          <span aria-hidden="true">•</span>
          <span>Live polling every 12s</span>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              router.refresh();
            });
          }}
          className="gap-1.5"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isPending && !activeActionId ? "animate-spin" : ""}`}
          />
          Refresh Desk
        </Button>
      </div>

      {/* Currently Called / In Consultation Quick Workflow Panel */}
      {activeCalledOrConsultingAppointments.length > 0 && (
        <Card className="border-indigo-500/50 bg-indigo-50/70 dark:bg-indigo-950/30 shadow-sm">
          <CardHeader className="py-3 px-4 border-b border-indigo-500/20 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-sm font-bold text-indigo-950 dark:text-indigo-100 flex items-center gap-2">
              <BellRing className="h-4 w-4 text-indigo-600 animate-pulse" />
              Active Called &amp; In-Consultation Patients
              <Badge className="bg-indigo-600 text-white text-[10px]">
                {activeCalledOrConsultingAppointments.length} active
              </Badge>
            </CardTitle>
          </CardHeader>

          <CardContent className="p-4 space-y-2.5">
            {activeCalledOrConsultingAppointments.map((activeAppt) => (
              <div
                key={`active-consult-${activeAppt.id}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-card border border-indigo-400/50 p-3 text-xs"
              >
                <div className="space-y-0.5">
                  <p className="font-bold text-foreground flex items-center gap-2 flex-wrap">
                    <Badge className="bg-indigo-600 text-white text-[10px]">
                      Token {activeAppt.tokenLabel}
                    </Badge>
                    {getAppointmentStatusBadge(activeAppt.status)}
                    <span>
                      Dr. {activeAppt.doctorName} — {activeAppt.patientName} ({activeAppt.subSlotLabel})
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    {activeAppt.calledAt
                      ? `Called at ${formatTimeIST(activeAppt.calledAt)} IST`
                      : "Called"}
                    {activeAppt.actualStartAt
                      ? ` • Consultation started at ${formatTimeIST(activeAppt.actualStartAt)} IST`
                      : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {activeAppt.canStartConsultation && (
                    <Button
                      type="button"
                      size="xs"
                      disabled={isPending || Boolean(activeActionId)}
                      onClick={() => handleStartConsultation(activeAppt, true)}
                      className="gap-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      <Play className="h-3 w-3" />
                      Start Consultation
                    </Button>
                  )}
                  {activeAppt.canMarkCompleted && (
                    <Button
                      type="button"
                      size="xs"
                      disabled={isPending || Boolean(activeActionId)}
                      onClick={() => handleCompleted(activeAppt, true)}
                      className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Completed
                    </Button>
                  )}
                  {activeAppt.canShowNotArrivedAction && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={
                        isPending ||
                        Boolean(activeActionId) ||
                        !activeAppt.canMarkNotArrived
                      }
                      title={
                        activeAppt.notArrivedDisabledReason ??
                        "Mark Not Arrived"
                      }
                      onClick={() => handleNotArrived(activeAppt, true)}
                      className="gap-1 text-rose-600 border-rose-300"
                    >
                      <UserX className="h-3 w-3" />
                      Not Arrived
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Overview Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-primary" />
              Total Scheduled
            </span>
            <div className="text-2xl font-bold text-foreground mt-1">
              {data.overview.totalAppointmentsToday}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {data.overview.awaitingArrival} awaiting
              {data.overview.paymentHoldAppointments > 0
                ? ` • ${data.overview.paymentHoldAppointments} hold`
                : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
              Checked-In
            </span>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {data.overview.checkedInPatients}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Arrivals recorded
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              Waiting
            </span>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              {data.overview.waitingPatients}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Checked in &amp; ready
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-indigo-600" />
              Called / Active
            </span>
            <div className="text-2xl font-bold text-indigo-600 mt-1">
              {data.overview.inConsultation}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {data.overview.calledPatients} called
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
              Completed
            </span>
            <div className="text-2xl font-bold text-foreground mt-1">
              {data.overview.completedConsultations}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Consultations done
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <UserX className="h-3.5 w-3.5 text-rose-600" />
              Not Arrived
            </span>
            <div className="text-2xl font-bold text-rose-600 mt-1">
              {data.overview.noShowPatients}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {data.overview.cancelledAppointments} cancelled
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Views */}
      <Tabs defaultValue="appointments" className="space-y-4">
        <TabsList>
          <TabsTrigger value="appointments">
            Queue Table ({data.appointments.length})
          </TabsTrigger>
          <TabsTrigger value="queues">
            Doctor &amp; Sub-Slot Queues ({data.doctorQueues.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Master Queue Table + Selected Sub-Slot Call Control */}
        <TabsContent value="appointments" className="space-y-4">
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
                <div className="lg:col-span-2 space-y-1">
                  <label
                    htmlFor="receptionist-search"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Search Patient, Ref, or Token
                  </label>
                  <div className="relative">
                    <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="receptionist-search"
                      placeholder="Name, token (#1), ref, phone..."
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      className="pl-9 h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="receptionist-doctor-filter"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Doctor
                  </label>
                  <select
                    id="receptionist-doctor-filter"
                    value={doctorFilter}
                    onChange={(e) => {
                      setDoctorFilter(e.target.value);
                      setSubSlotFilter("ALL");
                      setPage(1);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="ALL">All Doctors</option>
                    {data.doctors.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        Dr. {doc.name} ({doc.specialization})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="receptionist-subslot-filter"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Sub-Slot Queue
                  </label>
                  <select
                    id="receptionist-subslot-filter"
                    value={effectiveSubSlotFilter}
                    onChange={(e) => {
                      setSubSlotFilter(e.target.value);
                      setPage(1);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="ALL">All Sub-Slots</option>
                    {subSlotOptions.map((opt) => (
                      <option key={opt.scopeKey} value={opt.scopeKey}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="receptionist-status-filter"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Status
                  </label>
                  <select
                    id="receptionist-status-filter"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as AppointmentStatus | "ALL");
                      setPage(1);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value={AppointmentStatus.CONFIRMED}>Waiting (Confirmed)</option>
                    <option value={AppointmentStatus.CHECKED_IN}>Checked In</option>
                    <option value={AppointmentStatus.CALLED}>Called</option>
                    <option value={AppointmentStatus.IN_CONSULTATION}>In Consultation</option>
                    <option value={AppointmentStatus.COMPLETED}>Completed</option>
                    <option value={AppointmentStatus.NO_SHOW}>Not Arrived</option>
                    <option value={AppointmentStatus.CANCELLED}>Cancelled</option>
                    <option value={AppointmentStatus.PENDING_PAYMENT}>Payment Pending (Hold)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="receptionist-checkin-filter"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Check-In
                  </label>
                  <select
                    id="receptionist-checkin-filter"
                    value={checkInFilter}
                    onChange={(e) => {
                      setCheckInFilter(
                        e.target.value as "ALL" | "CHECKED_IN" | "NOT_CHECKED_IN"
                      );
                      setPage(1);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="ALL">All Check-In States</option>
                    <option value="CHECKED_IN">Checked In</option>
                    <option value="NOT_CHECKED_IN">Not Checked In</option>
                  </select>
                </div>
              </div>

              {hasActiveFilters && (
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Showing <strong className="text-foreground">{filteredAppointments.length}</strong> of{" "}
                    {data.appointments.length} appointments
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={clearFilters}
                  >
                    Clear Filters
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Selected Sub-Slot Call Next Patient Banner (appears when a specific sub-slot is selected) */}
          {selectedSubSlotQueue && (
            <Card className="border-primary/30 bg-primary/5 shadow-xs">
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <Megaphone className="h-3.5 w-3.5" />
                    Dr. {selectedSubSlotQueue.doctorName} — {selectedSubSlotQueue.subSlotLabel}
                  </p>
                  {selectedSubSlotQueue.nextPatient ? (
                    <p className="text-sm font-bold text-foreground">
                      Next Eligible: Token {selectedSubSlotQueue.nextPatient.tokenLabel} —{" "}
                      {selectedSubSlotQueue.nextPatient.patientName}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {selectedSubSlotQueue.callDisabledReason}
                    </p>
                  )}
                </div>

                <Button
                  type="button"
                  size="sm"
                  disabled={
                    isPending ||
                    Boolean(activeActionId) ||
                    !selectedSubSlotQueue.canCallNext
                  }
                  title={
                    selectedSubSlotQueue.callDisabledReason ??
                    "Call next checked-in patient in this sub-slot"
                  }
                  onClick={() => handleCallNextPatient(selectedSubSlotQueue)}
                  className="gap-1.5 font-semibold shrink-0"
                >
                  <Megaphone className="h-4 w-4" />
                  Call Next Patient
                </Button>
              </CardContent>
            </Card>
          )}

          {filteredAppointments.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-14 text-center space-y-2">
                <Users className="h-9 w-9 text-muted-foreground/40" />
                <h3 className="text-base font-semibold text-foreground">
                  {data.appointments.length === 0
                    ? "No Appointments Scheduled on This Date"
                    : "No Matching Appointments"}
                </h3>
                <p className="text-xs text-muted-foreground max-w-md">
                  {data.appointments.length === 0
                    ? "Try selecting another clinic date above or wait for bookings."
                    : "Try adjusting your patient search, doctor, sub-slot, or status filters."}
                </p>
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearFilters}
                    className="mt-2"
                  >
                    Reset Filters
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-xs font-semibold">Token</TableHead>
                      <TableHead className="text-xs font-semibold">Patient</TableHead>
                      <TableHead className="text-xs font-semibold">Contact</TableHead>
                      <TableHead className="text-xs font-semibold">Doctor</TableHead>
                      <TableHead className="text-xs font-semibold">Sub-Slot / Time</TableHead>
                      <TableHead className="text-xs font-semibold">Queue Position</TableHead>
                      <TableHead className="text-xs font-semibold">Status</TableHead>
                      <TableHead className="text-xs font-semibold">Check-In</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedAppointments.map((appt) => {
                      const streamConfig = STREAM_CONFIGS[appt.stream];

                      return (
                        <TableRow
                          key={appt.id}
                          className={`text-xs ${
                            appt.isCalled || appt.isInConsultation
                              ? "bg-indigo-50/70 dark:bg-indigo-950/30 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                              : ""
                          }`}
                        >
                          <TableCell className="align-top">
                            <div className="space-y-0.5">
                              <span
                                className={`inline-flex items-center gap-1 font-bold ${
                                  appt.isCalled || appt.isInConsultation
                                    ? "text-indigo-700 dark:text-indigo-300"
                                    : "text-foreground"
                                }`}
                              >
                                <Hash className="h-3 w-3 text-primary" />
                                {appt.tokenLabel}
                              </span>
                              <span className="block text-[10px] text-muted-foreground font-mono">
                                Ref {appt.referenceCode}
                              </span>
                            </div>
                          </TableCell>

                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <span className="font-semibold text-foreground block">
                                {appt.patientName}
                              </span>
                              <span
                                className={`inline-flex items-center text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-full border ${streamConfig.badgeClassName}`}
                              >
                                {streamConfig.label}
                              </span>
                            </div>
                          </TableCell>

                          <TableCell className="align-top text-muted-foreground">
                            <span className="inline-flex items-center gap-1 break-all">
                              <Phone className="h-3 w-3 shrink-0" />
                              {appt.contact}
                            </span>
                          </TableCell>

                          <TableCell className="align-top">
                            <span className="font-medium text-foreground block">
                              Dr. {appt.doctorName}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {appt.doctorSpecialization}
                            </span>
                          </TableCell>

                          <TableCell className="align-top">
                            <span className="font-medium text-foreground block whitespace-nowrap">
                              {formatSlotRange(appt.scheduledStart, appt.scheduledEnd)}
                            </span>
                            <span className="text-[10px] text-primary/90 block">
                              {appt.subSlotLabel}
                            </span>
                            {appt.arrivalWindow && (
                              <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                                <Waves className="h-3 w-3 shrink-0" />
                                Arrival: {appt.arrivalWindow}
                              </span>
                            )}
                          </TableCell>

                          <TableCell className="align-top">
                            {appt.queuePosition !== null ? (
                              <div className="space-y-0.5">
                                <span className="font-semibold text-foreground block">
                                  {appt.isInConsultation
                                    ? "In Consultation"
                                    : appt.isCalled
                                      ? "Called Now"
                                      : `#${appt.queuePosition} in sub-slot`}
                                </span>
                                {appt.expectedStart && (
                                  <span className="text-[11px] text-muted-foreground block whitespace-nowrap">
                                    Est. {formatTimeIST(appt.expectedStart)}
                                    {appt.roundedDelayMinutes > 0 && (
                                      <span className="text-rose-600 font-semibold ml-1">
                                        (+{appt.roundedDelayMinutes}m)
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="align-top">
                            <div className="space-y-1">
                              {getAppointmentStatusBadge(appt.status)}
                              {appt.calledAt && appt.status === AppointmentStatus.CALLED && (
                                <span className="block text-[10px] text-indigo-700 dark:text-indigo-300 font-medium">
                                  Called {formatTimeIST(appt.calledAt)}
                                </span>
                              )}
                              {appt.actualStartAt &&
                                appt.status === AppointmentStatus.IN_CONSULTATION && (
                                  <span className="block text-[10px] text-blue-700 dark:text-blue-300 font-medium">
                                    Started {formatTimeIST(appt.actualStartAt)}
                                  </span>
                                )}
                            </div>
                          </TableCell>

                          <TableCell className="align-top">
                            {appt.isCheckedIn ? (
                              <div className="space-y-0.5">
                                <Badge
                                  variant="secondary"
                                  className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] uppercase font-semibold"
                                >
                                  Checked In
                                </Badge>
                                {appt.checkedInAt && (
                                  <span className="block text-[10px] text-muted-foreground">
                                    {formatTimeIST(appt.checkedInAt)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px] uppercase text-muted-foreground font-semibold"
                              >
                                Not Checked In
                              </Badge>
                            )}
                          </TableCell>

                          <TableCell className="align-top text-right">
                            {renderRowActions(appt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  <span>
                    Page <strong className="text-foreground">{safePage}</strong> of {totalPages} ({filteredAppointments.length} rows)
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Prev
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* Tab 2: Doctor & Sub-Slot Queues with Centralized Call Next / Start / Complete Controls */}
        <TabsContent value="queues" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Independent sub-slot queues grouped per practitioner. Call Next Patient, Start Consultation, Complete Consultation, Check In, and Not Arrived are operated directly here.
            </p>
            <div className="w-full sm:w-64">
              <select
                aria-label="Filter queue by doctor"
                value={queueDoctorFilter}
                onChange={(e) => setQueueDoctorFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="ALL">All Active Doctors ({data.doctorQueues.length})</option>
                {data.doctorQueues.map((doc) => (
                  <option key={doc.doctorId} value={doc.doctorId}>
                    Dr. {doc.doctorName} ({doc.specialization})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {visibleDoctorQueues.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-14 text-center space-y-2">
                <Stethoscope className="h-9 w-9 text-muted-foreground/40" />
                <h3 className="text-base font-semibold text-foreground">
                  No Doctor Queues Active for This Date
                </h3>
                <p className="text-xs text-muted-foreground max-w-md">
                  Queues appear automatically once patients hold scheduled appointments on the selected date.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {visibleDoctorQueues.map((queue) => (
                <Card key={queue.doctorId} className="border-border shadow-xs overflow-hidden">
                  <CardHeader className="border-b border-border bg-muted/30 py-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                          <Stethoscope className="h-4 w-4 text-primary" />
                          Dr. {queue.doctorName}
                          <Badge variant="outline" className="text-[10px] font-medium">
                            {queue.specialization}
                          </Badge>
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span>Waiting (Checked In): <strong className="text-amber-600">{queue.waiting}</strong></span>
                          <span>Called / Consulting: <strong className="text-indigo-600">{queue.inProgress}</strong></span>
                          <span>Awaiting Arrival: <strong className="text-foreground">{queue.awaitingArrival}</strong></span>
                          <span>Completed: <strong className="text-emerald-600">{queue.completed}</strong></span>
                          <span>Not Arrived: <strong className="text-rose-600">{queue.noShow}</strong></span>
                        </div>
                      </div>

                      <Badge
                        variant={queue.runningBehindMinutes > 0 ? "destructive" : "success"}
                        className="text-xs font-semibold w-fit"
                      >
                        {queue.runningBehindMinutes > 0
                          ? `Max Sub-Slot Delay: +${queue.runningBehindMinutes} min`
                          : "On Time"}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="p-4 sm:p-5 space-y-5">
                    {queue.subSlots.map((subSlot) => {
                      const isCallingThisSubSlot =
                        activeActionId === `call:${subSlot.queueScopeKey}`;

                      return (
                        <div
                          key={subSlot.queueScopeKey}
                          className="rounded-xl border border-border p-4 space-y-3 bg-card"
                        >
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-border/60 pb-3">
                            <div>
                              <h3 className="text-sm font-bold text-foreground">
                                {subSlot.subSlotLabel}
                              </h3>
                              <p className="text-[11px] text-muted-foreground">
                                Checked In: <strong>{subSlot.summary.waiting}</strong> • Active Call/Room:{" "}
                                <strong>{subSlot.summary.inProgress}</strong> • Done:{" "}
                                <strong>{subSlot.summary.completed}</strong>
                              </p>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              {subSlot.currentlyConsulting && (
                                <Badge className="bg-indigo-600 text-white text-[11px]">
                                  {subSlot.currentlyConsulting.isInConsultation
                                    ? "In Consultation: "
                                    : "Called: "}
                                  Token {subSlot.currentlyConsulting.tokenLabel} —{" "}
                                  {subSlot.currentlyConsulting.patientName}
                                </Badge>
                              )}
                              <Button
                                type="button"
                                size="xs"
                                disabled={
                                  isPending ||
                                  Boolean(activeActionId) ||
                                  !subSlot.canCallNext
                                }
                                title={
                                  subSlot.callDisabledReason ??
                                  `Call next patient (${subSlot.nextPatient?.tokenLabel ?? ""})`
                                }
                                onClick={() => handleCallNextPatient(subSlot)}
                                className="gap-1.5 font-semibold"
                              >
                                {isCallingThisSubSlot ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Megaphone className="h-3.5 w-3.5" />
                                )}
                                Call Next Patient
                              </Button>
                            </div>
                          </div>

                          {subSlot.activeQueue.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2 text-center">
                              No remaining active patients in this sub-slot queue.
                            </p>
                          ) : (
                            <div className="overflow-x-auto rounded-lg border border-border">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/30">
                                    <TableHead className="text-xs font-semibold">Token / Pos</TableHead>
                                    <TableHead className="text-xs font-semibold">Patient</TableHead>
                                    <TableHead className="text-xs font-semibold">Est. Start</TableHead>
                                    <TableHead className="text-xs font-semibold">Status</TableHead>
                                    <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {subSlot.activeQueue.map((item) => {
                                    const streamConfig = STREAM_CONFIGS[item.stream];

                                    return (
                                      <TableRow
                                        key={item.id}
                                        className={`text-xs ${
                                          item.isCalled || item.isInConsultation
                                            ? "bg-indigo-50/70 dark:bg-indigo-950/30"
                                            : ""
                                        }`}
                                      >
                                        <TableCell className="whitespace-nowrap">
                                          <span className="font-bold text-foreground block">
                                            Token {item.tokenLabel}
                                          </span>
                                          <span className="text-[10px] text-muted-foreground">
                                            {item.isInConsultation
                                              ? "In Consultation"
                                              : item.isCalled
                                                ? "Called"
                                                : `Queue #${item.queuePosition}`}
                                          </span>
                                        </TableCell>
                                        <TableCell>
                                          <span className="font-semibold text-foreground block">
                                            {item.patientName}
                                          </span>
                                          <span
                                            className={`inline-flex items-center text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-full border mt-0.5 ${streamConfig.badgeClassName}`}
                                          >
                                            {streamConfig.label}
                                          </span>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                          {item.expectedStart ? (
                                            <span>
                                              {formatTimeIST(item.expectedStart)}
                                              {item.roundedDelayMinutes > 0 && (
                                                <span className="text-rose-600 font-semibold ml-1">
                                                  (+{item.roundedDelayMinutes}m)
                                                </span>
                                              )}
                                            </span>
                                          ) : (
                                            "—"
                                          )}
                                        </TableCell>
                                        <TableCell>{getAppointmentStatusBadge(item.status)}</TableCell>
                                        <TableCell className="text-right">
                                          {renderRowActions(item, true)}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {(queue.completedPatients.length > 0 ||
                      queue.noShowPatients.length > 0 ||
                      queue.cancelledPatients.length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        {queue.completedPatients.length > 0 && (
                          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                              Completed Patients ({queue.completedPatients.length})
                            </span>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {queue.completedPatients.map((p) => (
                                <li key={p.id} className="flex justify-between gap-2">
                                  <span className="text-foreground font-medium truncate">
                                    {p.tokenLabel} {p.patientName}
                                  </span>
                                  <span className="shrink-0">
                                    {formatSlotRange(p.scheduledStart, p.scheduledEnd)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {(queue.noShowPatients.length > 0 || queue.cancelledPatients.length > 0) && (
                          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                            <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                              Not Arrived &amp; Cancelled ({queue.noShowPatients.length + queue.cancelledPatients.length})
                            </span>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {[...queue.noShowPatients, ...queue.cancelledPatients].map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-2">
                                  <span className="text-foreground font-medium truncate">
                                    {p.tokenLabel} {p.patientName}
                                  </span>
                                  <span className="flex items-center gap-1.5 shrink-0">
                                    {getAppointmentStatusBadge(p.status)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
