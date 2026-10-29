"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  publishWaveAction,
  reassignWaveAppointmentAction,
} from "@/lib/actions/waves";
import { formatTimeIST, formatDateTimeIST } from "@/lib/time";
import { STREAM_CONFIGS } from "@/lib/streams";
import {
  Waves,
  ArrowLeft,
  Users,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { SerializedWave } from "@/lib/serializers";

interface WaveAppointment {
  id: string;
  patientName: string;
  doctorName: string;
  stream: "NEW_CONSULTATION" | "FOLLOW_UP" | "PRIORITY";
  status: string;
  slotStartTime: string;
  slotEndTime: string;
  checkedInAt?: string | null;
}

interface OtherWaveOption {
  id: string;
  windowStart: string;
  windowEnd: string;
  status: string;
  assignedCount: number;
  capacity: number;
}

interface WaveDetailViewProps {
  wave: SerializedWave;
  assignedAppointments: WaveAppointment[];
  unassignedAppointments: WaveAppointment[];
  otherWaves: OtherWaveOption[];
}

export function WaveDetailView({
  wave,
  assignedAppointments,
  unassignedAppointments,
}: WaveDetailViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [acknowledgeOverflow, setAcknowledgeOverflow] = useState(false);

  const start = new Date(wave.windowStart);
  const end = new Date(wave.windowEnd);
  const isDraft = wave.status === "DRAFT";
  const isPublished = wave.status === "PUBLISHED";
  const isClosed = wave.status === "CLOSED";

  const totalOverflow = unassignedAppointments.length;

  const handlePublish = (overrideAcknowledge = false) => {
    startTransition(async () => {
      const res = await publishWaveAction({
        waveId: wave.id,
        acknowledgeOverflow: overrideAcknowledge || acknowledgeOverflow,
      });

      if (res.success) {
        toast.success(res.message);
        setIsPublishModalOpen(false);
        router.refresh();
      } else {
        if ("hasOverflow" in res && res.hasOverflow) {
          setIsPublishModalOpen(true);
        } else {
          toast.error(res.error);
        }
      }
    });
  };

  const handleReassign = (appointmentId: string, targetWaveId: string | null) => {
    startTransition(async () => {
      const res = await reassignWaveAppointmentAction({
        appointmentId,
        targetWaveId,
      });

      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/waves"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              All Waves
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1 flex items-center gap-2.5">
            <Waves className="h-7 w-7 text-primary" />
            Wave Review: {wave.specialization}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Window: <strong>{formatTimeIST(start)} — {formatTimeIST(end)}</strong> ({formatDateTimeIST(start).split(",")[0]})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            variant={isPublished ? "success" : isClosed ? "outline" : "warning"}
            className="text-xs uppercase px-3 py-1 font-semibold"
          >
            {wave.status}
          </Badge>

          {isDraft && (
            <Button
              variant="default"
              size="sm"
              disabled={isPending}
              onClick={() => handlePublish(false)}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
            >
              <CheckCircle2 className="h-4 w-4" />
              Publish Wave
            </Button>
          )}
        </div>
      </div>

      {/* Expected vs Actual Dashboard Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Expected Arrivals</span>
            <div className="text-2xl font-bold text-foreground mt-1">
              {wave.assignedCount} / {wave.capacity}
            </div>
            <span className="text-[10px] text-muted-foreground">Capacity limit</span>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">On-Time Arrivals</span>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{wave.onTimeCheckIns}</div>
            <span className="text-[10px] text-muted-foreground">Inside window</span>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Late Arrivals</span>
            <div className="text-2xl font-bold text-rose-600 mt-1">{wave.lateCheckIns}</div>
            <span className="text-[10px] text-muted-foreground">After window end</span>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">No-Shows</span>
            <div className="text-2xl font-bold text-amber-600 mt-1">{wave.noShows}</div>
            <span className="text-[10px] text-muted-foreground">Marked absent</span>
          </CardContent>
        </Card>

        <Card className="col-span-2 sm:col-span-1 bg-card border-border shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Pending Arrival</span>
            <div className="text-2xl font-bold text-blue-600 mt-1">{wave.notYetArrived}</div>
            <span className="text-[10px] text-muted-foreground">Not yet checked in</span>
          </CardContent>
        </Card>
      </div>

      {/* Assigned Appointments Table */}
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3 border-b border-border/70 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Assigned Consultations ({assignedAppointments.length} / {wave.capacity})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {assignedAppointments.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              No appointments currently assigned to this wave.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Patient</TableHead>
                  <TableHead className="text-xs">Practitioner</TableHead>
                  <TableHead className="text-xs">Scheduled Slot</TableHead>
                  <TableHead className="text-xs">Stream</TableHead>
                  <TableHead className="text-xs">Arrival Status</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedAppointments.map((appt) => {
                  const streamConfig = STREAM_CONFIGS[appt.stream];
                  const slotStart = new Date(appt.slotStartTime);
                  const slotEnd = new Date(appt.slotEndTime);

                  return (
                    <TableRow key={appt.id}>
                      <TableCell className="font-semibold text-xs text-foreground">
                        {appt.patientName}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        Dr. {appt.doctorName}
                      </TableCell>
                      <TableCell className="text-xs text-foreground">
                        {formatTimeIST(slotStart)} - {formatTimeIST(slotEnd)}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${streamConfig.badgeClassName}`}>
                          {streamConfig.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {appt.checkedInAt ? (
                          <Badge variant="success" className="text-[10px] uppercase">
                            Arrived {formatTimeIST(appt.checkedInAt)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            Expected
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!isClosed && (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={isPending}
                            onClick={() => handleReassign(appt.id, null)}
                            className="text-xs text-destructive hover:bg-destructive/10"
                          >
                            Remove
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Unassigned / Overflow Appointments */}
      {unassignedAppointments.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-900 bg-amber-50/20 dark:bg-amber-950/10 shadow-xs">
          <CardHeader className="pb-3 border-b border-amber-200 dark:border-amber-900 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Unassigned / Overflow Consultations ({unassignedAppointments.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Patient</TableHead>
                  <TableHead className="text-xs">Practitioner</TableHead>
                  <TableHead className="text-xs">Slot Time</TableHead>
                  <TableHead className="text-xs">Stream</TableHead>
                  <TableHead className="text-xs text-right">Assign</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassignedAppointments.map((appt) => {
                  const streamConfig = STREAM_CONFIGS[appt.stream];
                  const slotStart = new Date(appt.slotStartTime);
                  const canFitInThisWave = assignedAppointments.length < wave.capacity;

                  return (
                    <TableRow key={appt.id}>
                      <TableCell className="font-semibold text-xs text-foreground">
                        {appt.patientName}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        Dr. {appt.doctorName}
                      </TableCell>
                      <TableCell className="text-xs text-foreground">
                        {formatTimeIST(slotStart)}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border ${streamConfig.badgeClassName}`}>
                          {streamConfig.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {canFitInThisWave && !isClosed && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={isPending}
                            onClick={() => handleReassign(appt.id, wave.id)}
                            className="text-xs"
                          >
                            Add to this Wave
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Overflow Publish Confirmation Modal */}
      <Dialog open={isPublishModalOpen} onOpenChange={setIsPublishModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Unresolved Overflow Detected
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              This department has {totalOverflow} confirmed consultation(s) within this time frame that could not fit into the wave capacity ({wave.capacity}).
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 space-y-2">
            <p>
              Publishing will assign up to {wave.capacity} patients and notify them of their arrival window. The remaining {totalOverflow} patient(s) will remain unassigned.
            </p>
            <label className="flex items-center gap-2 font-semibold pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledgeOverflow}
                onChange={(e) => setAcknowledgeOverflow(e.target.checked)}
                className="rounded border-border"
              />
              <span>I acknowledge the unassigned overflow and wish to publish.</span>
            </label>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPublishModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={!acknowledgeOverflow || isPending}
              onClick={() => handlePublish(true)}
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            >
              {isPending ? "Publishing..." : "Acknowledge & Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
