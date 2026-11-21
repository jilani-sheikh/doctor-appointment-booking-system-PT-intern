"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  BellRing,
  CheckCircle2,
  Clock,
  Eye,
  Hash,
  RefreshCw,
  User,
  UserX,
  Users,
  AlertCircle,
} from "lucide-react";
import { formatSlotRange, formatTimeIST } from "@/lib/time";
import { EMERGENCY_DISCLAIMER } from "@/lib/queue";
import type { AppointmentStatus } from "@/generated/prisma/enums";
import type {
  DoctorLiveQueueData,
  DoctorQueuePatientRow,
} from "@/lib/doctor-queue";

interface DoctorQueueViewProps {
  data: DoctorLiveQueueData;
}

export function DoctorQueueView({ data }: DoctorQueueViewProps) {
  const router = useRouter();
  const [selectedScopeKey, setSelectedScopeKey] = useState<string>(
    data.defaultSelectedScopeKey ?? ""
  );

  // Live auto-refresh every 15 seconds while tab is active and visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [router]);

  const activeSubSlot =
    data.subSlots.find((s) => s.queueScopeKey === selectedScopeKey) ??
    data.subSlots.find((s) => s.queueScopeKey === data.defaultSelectedScopeKey) ??
    data.subSlots[0] ??
    null;

  const renderStatusBadge = (status: AppointmentStatus, label: string) => {
    switch (status) {
      case "CONFIRMED":
        return (
          <Badge variant="outline" className="text-[10px] uppercase font-semibold border-amber-500/40 text-amber-700 dark:text-amber-300">
            {label}
          </Badge>
        );
      case "CHECKED_IN":
        return (
          <Badge className="bg-blue-600 text-white text-[10px] uppercase font-semibold">
            {label}
          </Badge>
        );
      case "CALLED":
        return (
          <Badge className="bg-indigo-600 text-white text-[10px] uppercase font-semibold animate-pulse">
            {label}
          </Badge>
        );
      case "IN_CONSULTATION":
        return (
          <Badge className="bg-emerald-600 text-white text-[10px] uppercase font-semibold animate-pulse">
            {label}
          </Badge>
        );
      case "COMPLETED":
        return (
          <Badge className="bg-emerald-700/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] uppercase font-semibold">
            {label}
          </Badge>
        );
      case "NO_SHOW":
        return (
          <Badge variant="destructive" className="bg-rose-700 text-[10px] uppercase font-semibold">
            {label}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px] uppercase">
            {label}
          </Badge>
        );
    }
  };

  const renderPatientRow = (row: DoctorQueuePatientRow) => {
    const start = new Date(row.scheduledStart);
    const end = new Date(row.scheduledEnd);

    return (
      <div
        key={row.id}
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border transition-colors ${
          row.isCurrent
            ? "border-indigo-500/50 bg-indigo-50/40 dark:bg-indigo-950/20 shadow-xs"
            : row.status === "CHECKED_IN"
              ? "border-blue-500/30 bg-blue-50/20 dark:bg-blue-950/10"
              : row.status === "COMPLETED" || row.status === "NO_SHOW"
                ? "border-border/60 bg-muted/20 opacity-85"
                : "border-border bg-card"
        }`}
      >
        <div className="flex items-start sm:items-center gap-3.5">
          <div
            className={`flex h-11 min-w-11 px-2 items-center justify-center rounded-lg border font-bold text-sm shrink-0 ${
              row.isCurrent
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-primary/10 text-primary border-primary/20"
            }`}
          >
            {row.tokenLabel}
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {row.patientName}
              </span>
              {renderStatusBadge(row.status, row.statusLabel)}
              {row.queuePosition !== null && !row.isCurrent && (
                <Badge variant="outline" className="text-[10px] font-medium">
                  Queue #{row.queuePosition}
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">
                • {row.subSlotLabel}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1 font-medium text-foreground">
                <Clock className="h-3 w-3 text-primary" />
                {formatSlotRange(start, end)}
              </span>
              {row.checkedInAt && (
                <>
                  <span>•</span>
                  <span className="text-blue-700 dark:text-blue-300 font-medium">
                    Checked In: {formatTimeIST(row.checkedInAt)}
                  </span>
                </>
              )}
              {row.calledAt && (
                <>
                  <span>•</span>
                  <span className="text-indigo-700 dark:text-indigo-300 font-medium">
                    Called: {formatTimeIST(row.calledAt)}
                  </span>
                </>
              )}
              {row.actualStartAt && (
                <>
                  <span>•</span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                    Started: {formatTimeIST(row.actualStartAt)}
                  </span>
                </>
              )}
              {row.completedAt && (
                <>
                  <span>•</span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                    Completed: {formatTimeIST(row.completedAt)}
                  </span>
                </>
              )}
              {row.noShowAt && (
                <>
                  <span>•</span>
                  <span className="text-rose-700 dark:text-rose-300 font-medium">
                    Marked Not Arrived: {formatTimeIST(row.noShowAt)}
                  </span>
                </>
              )}
              {row.expectedStart &&
                row.status !== "COMPLETED" &&
                row.status !== "NO_SHOW" && (
                  <>
                    <span>•</span>
                    <span>
                      Est. Consultation: <strong>{formatTimeIST(row.expectedStart)}</strong>
                      {row.roundedDelayMinutes > 0 && (
                        <span className="text-rose-600 font-semibold ml-1">
                          (+{row.roundedDelayMinutes} min)
                        </span>
                      )}
                    </span>
                  </>
                )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Read-Only Monitoring Banner & Emergency Disclaimer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-blue-500/30 bg-blue-50/40 dark:bg-blue-950/20 px-4 py-2.5 text-xs text-blue-950 dark:text-blue-100">
        <span className="flex items-center gap-2 font-medium">
          <Eye className="h-4 w-4 text-blue-600 shrink-0" />
          Read-only live queue monitor — all queue check-ins, calling, start/end consultation, and completion updates are controlled by the Reception Desk (auto-refreshes every 15s).
        </span>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
        <span>{EMERGENCY_DISCLAIMER}</span>
      </div>

      {/* Currently Called / Consulting Doctor-wide Highlight */}
      {data.activeDoctorCall && (
        <Card className="border-indigo-500/40 bg-indigo-50/60 dark:bg-indigo-950/25 shadow-sm">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <BellRing className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                  {data.activeDoctorCall.status === "CALLED"
                    ? "Currently Called Patient"
                    : "Current Patient In Consultation"}
                </p>
                <p className="text-base font-bold text-foreground mt-0.5">
                  Token {data.activeDoctorCall.tokenLabel} — {data.activeDoctorCall.patientName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.activeDoctorCall.subSlotLabel}
                  {data.activeDoctorCall.calledAt
                    ? ` • Called at ${formatTimeIST(data.activeDoctorCall.calledAt)}`
                    : ""}
                  {data.activeDoctorCall.actualStartAt
                    ? ` • Started at ${formatTimeIST(data.activeDoctorCall.actualStartAt)}`
                    : ""}
                </p>
              </div>
            </div>

            <Badge className="bg-indigo-600 text-white self-start sm:self-center">
              {data.activeDoctorCall.status === "IN_CONSULTATION"
                ? "In Consultation"
                : "Called by Reception"}
            </Badge>
          </CardContent>
        </Card>
      )}

      {data.subSlots.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-35 text-primary" />
            <h3 className="font-semibold text-foreground text-base">
              No Patients Scheduled in Today&apos;s Queue
            </h3>
            <p className="text-sm mt-1 max-w-sm">
              Your confirmed sub-slot queues for today will appear here automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Read-Only Sub-Slot Tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sub-Slot Queues ({data.subSlots.length})
              </p>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => router.refresh()}
                className="text-xs gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh View
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.subSlots.map((subSlot) => {
                const isSelected = activeSubSlot?.queueScopeKey === subSlot.queueScopeKey;
                return (
                  <button
                    key={subSlot.queueScopeKey}
                    type="button"
                    onClick={() => setSelectedScopeKey(subSlot.queueScopeKey)}
                    className={`text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-foreground">
                        {subSlot.timeRangeLabel}
                      </span>
                      <Badge variant={isSelected ? "default" : "outline"} className="text-[10px]">
                        {subSlot.kind === "WAVE_SLOT"
                          ? "Wave Sub-slot"
                          : subSlot.kind === "STREAM_WINDOW"
                            ? "Stream"
                            : "Slot"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs text-muted-foreground mt-1.5 flex-wrap">
                      <span className="text-blue-600 dark:text-blue-400 font-semibold">
                        {subSlot.summary.waiting} Checked In
                      </span>
                      <span>•</span>
                      <span>{subSlot.summary.remaining} Active</span>
                      <span>•</span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {subSlot.summary.completed} Done
                      </span>
                      {subSlot.noShowCount > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-rose-600 dark:text-rose-400">
                            {subSlot.noShowCount} Not Arrived
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {activeSubSlot && (
            <>
              {/* Read-Only Summary Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <Card className="border-border shadow-xs">
                  <CardHeader className="py-3 px-4">
                    <CardDescription className="text-xs">Checked In</CardDescription>
                    <CardTitle className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {activeSubSlot.summary.waiting}
                    </CardTitle>
                  </CardHeader>
                </Card>

                <Card className="border-border shadow-xs">
                  <CardHeader className="py-3 px-4">
                    <CardDescription className="text-xs">Called / Active</CardDescription>
                    <CardTitle className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                      {activeSubSlot.summary.inProgress}
                    </CardTitle>
                  </CardHeader>
                </Card>

                <Card className="border-border shadow-xs">
                  <CardHeader className="py-3 px-4">
                    <CardDescription className="text-xs">Remaining</CardDescription>
                    <CardTitle className="text-2xl font-bold text-foreground">
                      {activeSubSlot.summary.remaining}
                    </CardTitle>
                  </CardHeader>
                </Card>

                <Card className="border-border shadow-xs">
                  <CardHeader className="py-3 px-4">
                    <CardDescription className="text-xs">Completed</CardDescription>
                    <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {activeSubSlot.summary.completed}
                    </CardTitle>
                  </CardHeader>
                </Card>

                <Card className="border-border shadow-xs">
                  <CardHeader className="py-3 px-4">
                    <CardDescription className="text-xs">Not Arrived</CardDescription>
                    <CardTitle className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                      {activeSubSlot.noShowCount}
                    </CardTitle>
                  </CardHeader>
                </Card>

                <Card className="border-border shadow-xs">
                  <CardHeader className="py-3 px-4">
                    <CardDescription className="text-xs">Est. Delay</CardDescription>
                    <CardTitle
                      className={`text-2xl font-bold ${
                        activeSubSlot.summary.runningBehindMinutes > 0
                          ? "text-rose-600"
                          : "text-foreground"
                      }`}
                    >
                      {activeSubSlot.summary.runningBehindMinutes > 0
                        ? `${activeSubSlot.summary.runningBehindMinutes}m`
                        : "On Time"}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>

              {/* Read-Only Up Next Summary Card (NO action buttons) */}
              <Card className="border-primary/25 bg-primary/5 shadow-xs">
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5" />
                      {activeSubSlot.subSlotLabel}
                    </p>
                    {activeSubSlot.currentPatient ? (
                      <p className="text-sm font-bold text-foreground">
                        Current ({activeSubSlot.currentPatient.statusLabel}): Token{" "}
                        {activeSubSlot.currentPatient.tokenLabel} —{" "}
                        {activeSubSlot.currentPatient.patientName}
                      </p>
                    ) : activeSubSlot.nextInQueuePatient ? (
                      <p className="text-sm font-bold text-foreground">
                        Next Checked-In Patient: Token {activeSubSlot.nextInQueuePatient.tokenLabel} —{" "}
                        {activeSubSlot.nextInQueuePatient.patientName}
                      </p>
                    ) : (
                      <p className="text-sm font-medium text-muted-foreground">
                        No checked-in patient waiting right now in this sub-slot.
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[11px] w-fit">
                    Controlled by Reception Desk
                  </Badge>
                </CardContent>
              </Card>

              {/* Read-Only Active Queue List */}
              <div className="space-y-3">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Hash className="h-4 w-4 text-primary" />
                  Active Queue ({activeSubSlot.activePatients.length})
                </h2>

                {activeSubSlot.activePatients.length === 0 ? (
                  <Card className="border-dashed border">
                    <CardContent className="p-6 text-center text-xs text-muted-foreground">
                      No active patients waiting in this sub-slot.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2.5">
                    {activeSubSlot.activePatients.map(renderPatientRow)}
                  </div>
                )}
              </div>

              {/* Read-Only Completed Patients in This Sub-Slot */}
              {activeSubSlot.completedPatients.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Completed ({activeSubSlot.completedPatients.length})
                  </h2>
                  <div className="space-y-2.5">
                    {activeSubSlot.completedPatients.map(renderPatientRow)}
                  </div>
                </div>
              )}

              {/* Read-Only Not Arrived Patients in This Sub-Slot */}
              {activeSubSlot.notArrivedPatients.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <UserX className="h-4 w-4 text-rose-600" />
                    Not Arrived ({activeSubSlot.notArrivedPatients.length})
                  </h2>
                  <div className="space-y-2.5">
                    {activeSubSlot.notArrivedPatients.map(renderPatientRow)}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
