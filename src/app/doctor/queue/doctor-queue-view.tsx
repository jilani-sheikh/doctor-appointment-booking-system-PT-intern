"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  User,
  Clock,
  Play,
  CheckCircle2,
  UserCheck,
  UserX,
  Ban,
  Phone,
  AlertCircle,
  Activity,
  Waves,
} from "lucide-react";
import {
  doctorMarkArrivedAction,
  startConsultationAction,
  endConsultationAction,
  doctorNoShowAction,
  setPriorityStreamAction,
} from "@/lib/actions/queue";
import { updateDoctorAppointmentStatusAction } from "@/lib/actions/doctor-appointments";
import { formatTimeIST, formatSlotRange } from "@/lib/time";
import { STREAM_CONFIGS } from "@/lib/streams";
import { EMERGENCY_DISCLAIMER, type QueueSummary } from "@/lib/queue";
import type { SerializedDoctorQueueItem } from "@/lib/serializers";

interface DoctorQueueViewProps {
  queueItems: SerializedDoctorQueueItem[];
  summary: QueueSummary;
}

export function DoctorQueueView({ queueItems, summary }: DoctorQueueViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Auto-refresh queue every 30 seconds while tab is active and visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [router]);

  const handleMarkArrived = (appointmentId: string) => {
    startTransition(async () => {
      const res = await doctorMarkArrivedAction(appointmentId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleStartConsultation = (appointmentId: string) => {
    startTransition(async () => {
      const res = await startConsultationAction(appointmentId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleEndConsultation = (appointmentId: string) => {
    startTransition(async () => {
      const res = await endConsultationAction(appointmentId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleNoShow = (appointmentId: string) => {
    if (!confirm("Are you sure you want to mark this patient as No-Show?")) return;
    startTransition(async () => {
      const res = await doctorNoShowAction(appointmentId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleCancel = (appointmentId: string) => {
    if (!confirm("Are you sure you want to cancel this appointment and free the slot?")) return;
    startTransition(async () => {
      const res = await updateDoctorAppointmentStatusAction(appointmentId, "CANCELLED");
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleSetPriority = (appointmentId: string) => {
    startTransition(async () => {
      const res = await setPriorityStreamAction(appointmentId);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error);
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "CHECKED_IN":
        return <Badge variant="warning" className="text-[10px] uppercase font-semibold">Arrived / Waiting</Badge>;
      case "IN_CONSULTATION":
        return <Badge variant="default" className="text-[10px] uppercase bg-blue-600 animate-pulse font-semibold">In Consultation</Badge>;
      case "CONFIRMED":
        return <Badge variant="success" className="text-[10px] uppercase">Confirmed</Badge>;
      case "PENDING":
        return <Badge variant="outline" className="text-[10px] uppercase">Pending</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] uppercase">{status}</Badge>;
    }
  };

  const nextPatientToCall = queueItems.find((item) => item.status === "CHECKED_IN");

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Waiting Arrived</span>
            <div className="text-2xl font-bold text-amber-600 mt-1">{summary.waiting}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">In Consultation</span>
            <div className="text-2xl font-bold text-blue-600 mt-1">{summary.inProgress}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Remaining Today</span>
            <div className="text-2xl font-bold text-foreground mt-1">{summary.remaining}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Completed Today</span>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{summary.completed}</div>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1 bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Pace Delay</span>
            <div className={`text-2xl font-bold mt-1 ${summary.runningBehindMinutes > 0 ? "text-rose-600" : "text-emerald-600"}`}>
              {summary.runningBehindMinutes > 0 ? `+${summary.runningBehindMinutes} min` : "On Time"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Emergency Notice */}
      <div className="rounded-lg border border-border/80 bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-primary shrink-0" />
        <span>{EMERGENCY_DISCLAIMER}</span>
      </div>

      {/* Next Patient to Call Highlight Card */}
      {nextPatientToCall && (
        <Card className="border-2 border-blue-500/80 bg-gradient-to-r from-blue-50/50 via-indigo-50/20 to-transparent dark:from-blue-950/30 dark:via-indigo-950/10 dark:to-transparent shadow-md">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white uppercase tracking-wider">
                    <Play className="h-3 w-3 fill-current" /> Next Patient to Call
                  </span>
                  <span className="text-xs text-muted-foreground">Queue #{nextPatientToCall.queuePosition}</span>
                  {nextPatientToCall.arrivalWindow && (
                    <Badge variant="outline" className="border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-[10px] flex items-center gap-1 font-medium">
                      <Waves className="h-3 w-3" />
                      Arrival Window: {nextPatientToCall.arrivalWindow}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <User className="h-5 w-5 text-blue-600" />
                    {nextPatientToCall.patientName}
                  </h3>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Slot: {formatSlotRange(nextPatientToCall.scheduledStart, nextPatientToCall.scheduledEnd)}
                  </span>
                  {nextPatientToCall.checkedInAt && (
                    <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                      (Checked in at {formatTimeIST(nextPatientToCall.checkedInAt)})
                    </span>
                  )}
                  {nextPatientToCall.patientPhone && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {nextPatientToCall.patientPhone}
                    </span>
                  )}
                </div>
                {nextPatientToCall.reason && (
                  <p className="text-xs text-muted-foreground pt-1">
                    <strong>Complaint: </strong> {nextPatientToCall.reason}
                  </p>
                )}
              </div>

              <div className="shrink-0 flex items-center gap-2">
                <Button
                  size="default"
                  disabled={isPending}
                  onClick={() => handleStartConsultation(nextPatientToCall.id)}
                  className="gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Call Patient Now
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live Queue Cards */}
      {queueItems.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <Activity className="h-10 w-10 mb-3 opacity-30 text-primary" />
            <h3 className="font-semibold text-foreground text-base">No Active Consultations in Queue</h3>
            <p className="text-sm mt-1 max-w-sm">
              There are no pending, confirmed, or in-progress consultations scheduled for today.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {queueItems.map((item) => {
            const streamConfig = STREAM_CONFIGS[item.stream];
            const scheduledStart = new Date(item.scheduledStart);
            const scheduledEnd = new Date(item.scheduledEnd);
            const expectedStart = new Date(item.expectedStart);

            return (
              <Card
                key={item.id}
                className={`overflow-hidden border-border transition-all ${
                  item.isCurrent
                    ? "border-blue-500/60 shadow-md ring-1 ring-blue-500/30 bg-blue-50/20 dark:bg-blue-950/10"
                    : "hover:border-primary/40 shadow-xs"
                }`}
              >
                <CardContent className="p-5">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Patient & Slot Details */}
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                          #{item.queuePosition}
                        </span>
                        <span className="font-bold text-base text-foreground flex items-center gap-1.5">
                          <User className="h-4 w-4 text-primary" />
                          {item.patientName}
                        </span>
                        <span className={`inline-flex items-center text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${streamConfig.badgeClassName}`}>
                          {streamConfig.label}
                        </span>
                        {getStatusBadge(item.status)}
                        {item.arrivalWindow && (
                          <Badge variant="outline" className="border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-[10px] flex items-center gap-1 font-medium">
                            <Waves className="h-3 w-3" />
                            Arrival: {item.arrivalWindow}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                          Scheduled: {formatSlotRange(scheduledStart, scheduledEnd)}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          Est. Start: <strong className="text-foreground">{formatTimeIST(expectedStart)}</strong>
                          {item.roundedDelayMinutes > 0 && (
                            <span className="text-rose-600 font-semibold ml-1">
                              (+{item.roundedDelayMinutes} min approx)
                            </span>
                          )}
                        </span>
                        {item.patientPhone && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {item.patientPhone}
                            </span>
                          </>
                        )}
                      </div>

                      {item.reason && (
                        <p className="text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-md border border-border/50 max-w-2xl">
                          <strong className="text-foreground font-semibold">Chief Complaint / Reason: </strong>
                          {item.reason}
                        </p>
                      )}
                    </div>

                    {/* Action Controls */}
                    <div className="flex items-center gap-2 shrink-0 flex-wrap pt-3 lg:pt-0 border-t lg:border-t-0 border-border">
                      {item.canMarkArrived && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleMarkArrived(item.id)}
                          className="gap-1.5 text-xs text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          Mark Arrived
                        </Button>
                      )}

                      {item.canStartConsultation && (
                        <Button
                          variant="default"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleStartConsultation(item.id)}
                          className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Start Consultation
                        </Button>
                      )}

                      {item.canEndConsultation && (
                        <Button
                          variant="default"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleEndConsultation(item.id)}
                          className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          End Consultation
                        </Button>
                      )}

                      {item.stream !== "PRIORITY" && (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={isPending}
                          onClick={() => handleSetPriority(item.id)}
                          className="text-[11px] text-muted-foreground hover:text-rose-600"
                        >
                          Mark Priority
                        </Button>
                      )}

                      {item.canNoShow && (
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={isPending}
                          onClick={() => handleNoShow(item.id)}
                          className="text-xs text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border-rose-200 dark:border-rose-900"
                        >
                          <UserX className="h-3 w-3 mr-1" />
                          No-Show
                        </Button>
                      )}

                      {item.canCancel && (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={isPending}
                          onClick={() => handleCancel(item.id)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          <Ban className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
