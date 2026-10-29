"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Waves,
  Calendar,
  Clock,
  Users,
  Settings,
  Sparkles,
  Send,
  Plus,
  Trash2,
  CheckCircle2,
  ArrowRight,
  User,
} from "lucide-react";
import {
  updateDoctorWaveSettingsAction,
  generateDoctorWavesAction,
  createDoctorManualWaveAction,
  publishDoctorWaveAction,
  deleteDoctorDraftWaveAction,
  reassignDoctorWaveAppointmentAction,
} from "@/lib/actions/waves";
import { formatTimeIST } from "@/lib/time";
import type { SerializedDoctorWaveWithAppointments, SerializedUnassignedAppointment } from "./page";

interface DoctorWaveSettings {
  waveWindowMinutes: number;
  waveCapacity: number;
  arrivalBufferMinutes: number;
  autoPublishWaves: boolean;
}

interface DoctorWavesViewProps {
  dateStr: string;
  doctorSettings: DoctorWaveSettings;
  waves: SerializedDoctorWaveWithAppointments[];
  unassignedAppointments: SerializedUnassignedAppointment[];
}

export function DoctorWavesView({
  dateStr,
  doctorSettings: initialSettings,
  waves,
  unassignedAppointments,
}: DoctorWavesViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Settings form state
  const [settings, setSettings] = useState<DoctorWaveSettings>(initialSettings);
  const [isEditingSettings, setIsEditingSettings] = useState(false);

  // Manual wave modal state
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualStartTime, setManualStartTime] = useState("09:00");
  const [manualEndTime, setManualEndTime] = useState("10:00");
  const [manualCapacity, setManualCapacity] = useState(initialSettings.waveCapacity);
  const [manualNotes, setManualNotes] = useState("");

  // Assign modal state
  const [assignApptId, setAssignApptId] = useState<string | null>(null);
  const [selectedTargetWaveId, setSelectedTargetWaveId] = useState<string>("");

  // 1. Save Settings
  const handleSaveSettings = () => {
    startTransition(async () => {
      const res = await updateDoctorWaveSettingsAction(settings);
      if (res.success) {
        toast.success(res.message);
        setIsEditingSettings(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // 2. Generate Waves (Draft)
  const handleGenerate = (publishNow: boolean) => {
    startTransition(async () => {
      const res = await generateDoctorWavesAction({
        dateStr,
        publishNow,
      });
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // 3. Create Manual Wave
  const handleCreateManualWave = () => {
    startTransition(async () => {
      const res = await createDoctorManualWaveAction({
        dateStr,
        windowStartTime: manualStartTime,
        windowEndTime: manualEndTime,
        capacity: manualCapacity,
        notes: manualNotes || undefined,
      });
      if (res.success) {
        toast.success(res.message);
        setIsManualModalOpen(false);
        setManualNotes("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // 4. Publish Wave
  const handlePublishWave = (waveId: string) => {
    startTransition(async () => {
      const res = await publishDoctorWaveAction({ waveId });
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // 5. Delete Draft Wave
  const handleDeleteDraftWave = (waveId: string) => {
    if (!confirm("Are you sure you want to delete this draft wave? Appointments will become unassigned.")) return;
    startTransition(async () => {
      const res = await deleteDoctorDraftWaveAction({ waveId });
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // 6. Assign Appointment to Wave
  const handleAssignToWave = () => {
    if (!assignApptId || !selectedTargetWaveId) return;
    startTransition(async () => {
      const res = await reassignDoctorWaveAppointmentAction({
        appointmentId: assignApptId,
        targetWaveId: selectedTargetWaveId,
      });
      if (res.success) {
        toast.success(res.message);
        setAssignApptId(null);
        setSelectedTargetWaveId("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // Date change handler
  const handleDateChange = (newDate: string) => {
    router.push(`/doctor/waves?date=${newDate}`);
  };

  const publishedCount = waves.filter((w) => w.status === "PUBLISHED").length;
  const draftCount = waves.filter((w) => w.status === "DRAFT").length;
  const totalAssigned = waves.reduce((acc, w) => acc + w.assignedCount, 0);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 uppercase tracking-wider flex items-center gap-1">
              <Waves className="h-3.5 w-3.5" /> Wave Scheduling
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            Doctor Arrival Waves
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatic arrival staggered windows over your fixed consultation slots. Slot times and consultation order never change.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsManualModalOpen(true)}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Manual Wave
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleGenerate(false)}
            className="gap-1.5 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
          >
            <Sparkles className="h-4 w-4" />
            Generate Drafts
          </Button>

          <Button
            variant="default"
            size="sm"
            disabled={isPending}
            onClick={() => handleGenerate(true)}
            className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            <Send className="h-4 w-4" />
            Generate & Publish
          </Button>
        </div>
      </div>

      {/* Date Picker & Stats Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/30 p-4 rounded-xl border border-border">
        <div className="flex items-center gap-3">
          <Label htmlFor="wave-date" className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 shrink-0">
            <Calendar className="h-4 w-4 text-primary" />
            Consultation Date:
          </Label>
          <Input
            id="wave-date"
            type="date"
            value={dateStr}
            onChange={(e) => handleDateChange(e.target.value)}
            className="w-auto text-sm font-medium bg-background"
          />
        </div>

        <div className="flex items-center gap-6 text-xs text-muted-foreground flex-wrap">
          <div>
            Total Waves: <strong className="text-foreground text-sm">{waves.length}</strong>
          </div>
          <div>
            Published: <strong className="text-emerald-600 text-sm">{publishedCount}</strong>
          </div>
          <div>
            Draft: <strong className="text-amber-600 text-sm">{draftCount}</strong>
          </div>
          <div>
            Assigned: <strong className="text-foreground text-sm">{totalAssigned}</strong>
          </div>
          <div>
            Unassigned: <strong className="text-rose-600 text-sm">{unassignedAppointments.length}</strong>
          </div>
        </div>
      </div>

      {/* Doctor Wave Default Settings Card */}
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4 text-primary" />
              Automatic Wave Preferences
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              These settings control how your consultations are automatically grouped into wave windows.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditingSettings(!isEditingSettings)}
            className="text-xs"
          >
            {isEditingSettings ? "Cancel" : "Edit Settings"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Grouping Window (mins)</Label>
              {isEditingSettings ? (
                <Input
                  type="number"
                  min={5}
                  max={240}
                  value={settings.waveWindowMinutes}
                  onChange={(e) =>
                    setSettings({ ...settings, waveWindowMinutes: parseInt(e.target.value, 10) || 30 })
                  }
                />
              ) : (
                <div className="text-base font-semibold">{settings.waveWindowMinutes} minutes</div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Wave Capacity (patients)</Label>
              {isEditingSettings ? (
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={settings.waveCapacity}
                  onChange={(e) =>
                    setSettings({ ...settings, waveCapacity: parseInt(e.target.value, 10) || 3 })
                  }
                />
              ) : (
                <div className="text-base font-semibold">{settings.waveCapacity} patients / wave</div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Arrival Buffer (mins)</Label>
              {isEditingSettings ? (
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={settings.arrivalBufferMinutes}
                  onChange={(e) =>
                    setSettings({ ...settings, arrivalBufferMinutes: parseInt(e.target.value, 10) || 15 })
                  }
                />
              ) : (
                <div className="text-base font-semibold">{settings.arrivalBufferMinutes} mins before first slot</div>
              )}
            </div>

            <div className="space-y-1.5 flex flex-col justify-center">
              <Label className="text-xs text-muted-foreground">Auto-Publish Waves</Label>
              {isEditingSettings ? (
                <label className="flex items-center gap-2 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoPublishWaves}
                    onChange={(e) => setSettings({ ...settings, autoPublishWaves: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs">Publish automatically</span>
                </label>
              ) : (
                <div className="text-base font-semibold">
                  {settings.autoPublishWaves ? (
                    <span className="text-emerald-600">Enabled</span>
                  ) : (
                    <span className="text-muted-foreground">Manual confirmation (Draft)</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {isEditingSettings && (
            <div className="flex justify-end pt-2 border-t border-border">
              <Button
                size="sm"
                disabled={isPending}
                onClick={handleSaveSettings}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Save Preferences
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Grid: Waves List & Unassigned Appointments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Waves List (2 columns on lg) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Waves className="h-5 w-5 text-primary" />
              Waves for {dateStr} ({waves.length})
            </h2>
          </div>

          {waves.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Waves className="h-10 w-10 mb-3 opacity-30 text-primary" />
                <h3 className="font-semibold text-foreground text-base">No Waves Scheduled</h3>
                <p className="text-sm mt-1 max-w-md">
                  Click <strong>&quot;Generate Drafts&quot;</strong> or <strong>&quot;Generate & Publish&quot;</strong> to automatically group your consultations into arrival waves.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {waves.map((wave) => {
                const startTime = new Date(wave.windowStart);
                const endTime = new Date(wave.windowEnd);
                const isPublished = wave.status === "PUBLISHED";
                const isFull = wave.assignedCount >= wave.capacity;

                return (
                  <Card
                    key={wave.id}
                    className={`overflow-hidden border-border transition-all ${
                      isPublished ? "border-l-4 border-l-emerald-500 shadow-xs" : "border-l-4 border-l-amber-500 shadow-xs"
                    }`}
                  >
                    <CardContent className="p-5 space-y-4">
                      {/* Wave Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-base text-foreground">
                              Arrival Window: {formatTimeIST(startTime)} – {formatTimeIST(endTime)} (IST)
                            </h3>
                            {isPublished ? (
                              <Badge variant="success" className="text-[10px] uppercase font-semibold">
                                Published
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="text-[10px] uppercase font-semibold">
                                Draft
                              </Badge>
                            )}
                            {isFull && (
                              <Badge variant="secondary" className="text-[10px] uppercase font-semibold">
                                Full
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span>
                              Capacity: <strong>{wave.assignedCount} / {wave.capacity}</strong> patients
                            </span>
                            {wave.notes && (
                              <>
                                <span>•</span>
                                <span>Note: {wave.notes}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Wave Controls */}
                        <div className="flex items-center gap-2 shrink-0">
                          {!isPublished && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isPending}
                                onClick={() => handlePublishWave(wave.id)}
                                className="gap-1 text-xs text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Publish
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isPending}
                                onClick={() => handleDeleteDraftWave(wave.id)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Link
                            href={`/doctor/waves/${wave.id}`}
                            className={buttonVariants({ variant: "outline", size: "sm", className: "text-xs gap-1" })}
                          >
                            Details <ArrowRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>

                      {/* Performance strip for published waves */}
                      {isPublished && (
                        <div className="grid grid-cols-4 gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs">
                          <div>
                            <span className="text-[10px] text-muted-foreground">Expected</span>
                            <div className="font-bold text-foreground">{wave.assignedCount}</div>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground">On-Time</span>
                            <div className="font-bold text-emerald-600">{wave.onTimeCheckIns}</div>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground">Late</span>
                            <div className="font-bold text-rose-600">{wave.lateCheckIns}</div>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground">Awaiting</span>
                            <div className="font-bold text-blue-600">{wave.notYetArrived}</div>
                          </div>
                        </div>
                      )}

                      {/* Assigned Patients Sub-list */}
                      <div className="space-y-2 border-t border-border pt-3">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Assigned Consultations ({wave.appointments.length}):
                        </span>
                        {wave.appointments.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No consultations assigned to this wave window.</p>
                        ) : (
                          <div className="divide-y divide-border/60">
                            {wave.appointments.map((appt) => (
                              <div
                                key={appt.id}
                                className="py-2 flex items-center justify-between text-xs gap-2"
                              >
                                <div className="flex items-center gap-2">
                                  <User className="h-3.5 w-3.5 text-primary" />
                                  <span className="font-medium text-foreground">{appt.patientName}</span>
                                  <span className="text-muted-foreground">
                                    Slot: {formatTimeIST(appt.slotStartTime)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[10px]">
                                    {appt.status}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Unassigned Appointments List (1 column on lg) */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-600" />
            Unassigned ({unassignedAppointments.length})
          </h2>

          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Active Consultations Without a Wave</CardTitle>
              <CardDescription className="text-xs">
                Patients who do not have an arrival window assigned for this day.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {unassignedAppointments.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                  All active consultations have been assigned to waves!
                </div>
              ) : (
                unassignedAppointments.map((appt) => (
                  <div
                    key={appt.id}
                    className="p-3 rounded-lg border border-border/80 bg-muted/20 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">{appt.patientName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {appt.status}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Slot: {formatTimeIST(appt.slotStartTime)} – {formatTimeIST(appt.slotEndTime)}
                    </div>
                    {waves.length > 0 && (
                      <div className="pt-1">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setAssignApptId(appt.id)}
                          className="w-full text-xs"
                        >
                          Assign to Wave...
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Manual Wave Creation Modal */}
      <Dialog open={isManualModalOpen} onOpenChange={setIsManualModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Manual Arrival Wave</DialogTitle>
            <DialogDescription className="text-xs">
              Manually created waves enforce strict overlap checks to prevent scheduling conflicts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="manual-start" className="text-xs">Arrival Start Time (IST)</Label>
                <Input
                  id="manual-start"
                  type="time"
                  value={manualStartTime}
                  onChange={(e) => setManualStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-end" className="text-xs">Arrival End Time (IST)</Label>
                <Input
                  id="manual-end"
                  type="time"
                  value={manualEndTime}
                  onChange={(e) => setManualEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-capacity" className="text-xs">Capacity (Max Patients)</Label>
              <Input
                id="manual-capacity"
                type="number"
                min={1}
                max={50}
                value={manualCapacity}
                onChange={(e) => setManualCapacity(parseInt(e.target.value, 10) || 1)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-notes" className="text-xs">Notes (Optional)</Label>
              <Input
                id="manual-notes"
                placeholder="e.g. VIP slot / Review wave"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setIsManualModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isPending}
              onClick={handleCreateManualWave}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Create Draft Wave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Appointment to Wave Modal */}
      <Dialog open={Boolean(assignApptId)} onOpenChange={(open) => !open && setAssignApptId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Consultation to Wave</DialogTitle>
            <DialogDescription className="text-xs">
              Select an available wave window for this patient.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label className="text-xs font-semibold">Target Wave:</Label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {waves.map((w) => {
                const isFull = w.assignedCount >= w.capacity;
                return (
                  <div
                    key={w.id}
                    onClick={() => !isFull && setSelectedTargetWaveId(w.id)}
                    className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                      selectedTargetWaveId === w.id
                        ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30"
                        : isFull
                        ? "opacity-50 cursor-not-allowed border-border"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>{formatTimeIST(w.windowStart)} – {formatTimeIST(w.windowEnd)} IST</span>
                      <Badge variant={w.status === "PUBLISHED" ? "success" : "warning"} className="text-[10px]">
                        {w.status}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      {w.assignedCount} / {w.capacity} patients
                      {isFull && <span className="text-rose-600 font-semibold ml-2">(Full)</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setAssignApptId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isPending || !selectedTargetWaveId}
              onClick={handleAssignToWave}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Assign Patient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
