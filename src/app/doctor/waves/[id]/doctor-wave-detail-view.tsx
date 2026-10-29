"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Waves,
  ArrowLeft,
  Calendar,
  Clock,
  User,
  Trash2,
  ArrowRightLeft,
  Phone,
  Send,
} from "lucide-react";
import {
  publishDoctorWaveAction,
  deleteDoctorDraftWaveAction,
  reassignDoctorWaveAppointmentAction,
} from "@/lib/actions/waves";
import { formatTimeIST } from "@/lib/time";
import type { SerializedWave } from "@/lib/serializers";
import type { AppointmentStatus } from "@/generated/prisma/enums";

interface SiblingWave {
  id: string;
  windowStart: string;
  windowEnd: string;
  capacity: number;
  assignedCount: number;
  status: string;
}

interface AssignedAppointment {
  id: string;
  patientId: string;
  patientName: string;
  patientEmail?: string | null;
  patientPhone?: string | null;
  patientGender?: string | null;
  status: AppointmentStatus;
  stream: string;
  slotStartTime: string;
  slotEndTime: string;
  checkedInAt?: string | null;
}

interface DoctorWaveDetailViewProps {
  wave: SerializedWave;
  appointments: AssignedAppointment[];
  siblingWaves: SiblingWave[];
  dateStr: string;
}

export function DoctorWaveDetailView({
  wave,
  appointments,
  siblingWaves,
  dateStr,
}: DoctorWaveDetailViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Reassign / Move modal state
  const [reassignAppt, setReassignAppt] = useState<AssignedAppointment | null>(null);
  const [targetWaveId, setTargetWaveId] = useState<string | null>(null);

  const startTime = new Date(wave.windowStart);
  const endTime = new Date(wave.windowEnd);
  const isPublished = wave.status === "PUBLISHED";

  const handlePublish = () => {
    startTransition(async () => {
      const res = await publishDoctorWaveAction({ waveId: wave.id });
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleDeleteDraft = () => {
    if (!confirm("Are you sure you want to delete this draft wave? All appointments will become unassigned.")) return;
    startTransition(async () => {
      const res = await deleteDoctorDraftWaveAction({ waveId: wave.id });
      if (res.success) {
        toast.success(res.message);
        router.push(`/doctor/waves?date=${dateStr}`);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleReassign = () => {
    if (!reassignAppt) return;
    startTransition(async () => {
      const res = await reassignDoctorWaveAppointmentAction({
        appointmentId: reassignAppt.id,
        targetWaveId: targetWaveId,
      });
      if (res.success) {
        toast.success(res.message);
        setReassignAppt(null);
        setTargetWaveId(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleUnassign = (appointmentId: string) => {
    if (!confirm("Unassign this patient from this wave?")) return;
    startTransition(async () => {
      const res = await reassignDoctorWaveAppointmentAction({
        appointmentId,
        targetWaveId: null,
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
    <div className="space-y-8">
      {/* Back button and Header */}
      <div>
        <Link
          href={`/doctor/waves?date=${dateStr}`}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1 text-xs mb-3 -ml-2" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Waves
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 uppercase tracking-wider flex items-center gap-1">
                <Waves className="h-3.5 w-3.5" /> Wave Window
              </span>
              {isPublished ? (
                <Badge variant="success" className="text-xs uppercase font-semibold">
                  Published
                </Badge>
              ) : (
                <Badge variant="warning" className="text-xs uppercase font-semibold">
                  Draft
                </Badge>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {formatTimeIST(startTime)} – {formatTimeIST(endTime)} (IST)
            </h1>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" /> Date: {dateStr}
              <span>•</span>
              Capacity: <strong>{appointments.length} / {wave.capacity}</strong> patients
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isPublished && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  disabled={isPending}
                  onClick={handlePublish}
                  className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium"
                >
                  <Send className="h-4 w-4" />
                  Publish Wave
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isPending}
                  onClick={handleDeleteDraft}
                  className="gap-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Draft
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Performance Strip for Published Waves */}
      {isPublished && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">Expected Arrivals</span>
              <div className="text-2xl font-bold text-foreground mt-1">{appointments.length}</div>
            </CardContent>
          </Card>
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">On-Time Check-Ins</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{wave.onTimeCheckIns}</div>
            </CardContent>
          </Card>
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">Late Check-Ins</span>
              <div className="text-2xl font-bold text-rose-600 mt-1">{wave.lateCheckIns}</div>
            </CardContent>
          </Card>
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <span className="text-xs text-muted-foreground">Awaiting Arrival</span>
              <div className="text-2xl font-bold text-blue-600 mt-1">{wave.notYetArrived}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Assigned Consultations List */}
      <Card className="border-border shadow-xs">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Assigned Consultations ({appointments.length})</span>
            <span className="text-xs font-normal text-muted-foreground">
              Capacity: {appointments.length} of {wave.capacity}
            </span>
          </CardTitle>
          <CardDescription className="text-xs">
            Consultations assigned to arrive during this window. Consultation slots remain fixed and unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {appointments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No consultations currently assigned to this wave window.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {appointments.map((appt) => (
                <div
                  key={appt.id}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                        <User className="h-4 w-4 text-primary" />
                        {appt.patientName}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {appt.status}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {appt.stream}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        Consultation Slot: {formatTimeIST(appt.slotStartTime)} – {formatTimeIST(appt.slotEndTime)}
                      </span>
                      {appt.patientPhone && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {appt.patientPhone}
                          </span>
                        </>
                      )}
                      {appt.checkedInAt && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-600 font-medium">
                            Arrived at {formatTimeIST(appt.checkedInAt)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {siblingWaves.length > 0 && (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          setReassignAppt(appt);
                          setTargetWaveId(siblingWaves[0]?.id ?? null);
                        }}
                        className="gap-1 text-xs"
                      >
                        <ArrowRightLeft className="h-3 w-3" />
                        Move Wave
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={isPending}
                      onClick={() => handleUnassign(appt.id)}
                      className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      Unassign
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Move Wave Modal */}
      <Dialog open={Boolean(reassignAppt)} onOpenChange={(open) => !open && setReassignAppt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move Consultation to Another Wave</DialogTitle>
            <DialogDescription className="text-xs">
              Reassign {reassignAppt?.patientName} to an alternate wave window for {dateStr}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label className="text-xs font-semibold">Choose Target Wave:</Label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {siblingWaves.map((sw) => {
                const isFull = sw.assignedCount >= sw.capacity;
                return (
                  <div
                    key={sw.id}
                    onClick={() => !isFull && setTargetWaveId(sw.id)}
                    className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                      targetWaveId === sw.id
                        ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30"
                        : isFull
                        ? "opacity-50 cursor-not-allowed border-border"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>{formatTimeIST(sw.windowStart)} – {formatTimeIST(sw.windowEnd)} IST</span>
                      <Badge variant={sw.status === "PUBLISHED" ? "success" : "warning"} className="text-[10px]">
                        {sw.status}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      {sw.assignedCount} / {sw.capacity} patients
                      {isFull && <span className="text-rose-600 font-semibold ml-2">(Full)</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setReassignAppt(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isPending || !targetWaveId}
              onClick={handleReassign}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Move Consultation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
