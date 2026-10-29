"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createWaveAction,
  autoGenerateWavesAction,
} from "@/lib/actions/waves";
import { formatDateTimeIST, formatTimeIST } from "@/lib/time";
import { Waves, Plus, Sparkles, Users, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { VisitStream } from "@/generated/prisma/enums";
import type { SerializedWave } from "@/lib/serializers";

interface WavesListProps {
  waves: SerializedWave[];
  specializations: string[];
}

export function WavesList({ waves, specializations }: WavesListProps) {
  const [filterSpec, setFilterSpec] = useState<string>("ALL");
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [isAutoOpen, setIsAutoOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Manual wave form state
  const [spec, setSpec] = useState(specializations[0] ?? "Cardiology");
  const [dateStr, setDateStr] = useState("");
  const [startH, setStartH] = useState("09:00");
  const [endH, setEndH] = useState("11:00");
  const [capacity, setCapacity] = useState(4);
  const [stream, setStream] = useState<string>("ALL");
  const [notes, setNotes] = useState("");

  // Auto-generate form state
  const [autoSpec, setAutoSpec] = useState(specializations[0] ?? "Cardiology");
  const [autoDate, setAutoDate] = useState("");
  const [windowMin, setWindowMin] = useState(60);
  const [autoCap, setAutoCap] = useState(4);

  const handleManualCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dateStr) {
      toast.error("Please pick a date.");
      return;
    }

    startTransition(async () => {
      const res = await createWaveAction({
        specialization: spec,
        dateStr,
        windowStartTime: startH,
        windowEndTime: endH,
        capacity,
        stream: stream === "ALL" ? null : (stream as VisitStream),
        notes: notes || undefined,
      });

      if (res.success) {
        toast.success(res.message);
        setIsManualOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleAutoGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoDate) {
      toast.error("Please pick a date.");
      return;
    }

    startTransition(async () => {
      const res = await autoGenerateWavesAction({
        specialization: autoSpec,
        dateStr: autoDate,
        windowMinutes: windowMin,
        defaultCapacity: autoCap,
        earliestTimeStr: "09:00",
        latestTimeStr: "17:00",
      });

      if (res.success) {
        toast.success(res.message);
        setIsAutoOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const filteredWaves = filterSpec === "ALL"
    ? waves
    : waves.filter((w) => w.specialization.toLowerCase() === filterSpec.toLowerCase());

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Label className="text-xs font-semibold text-muted-foreground mr-1">Filter Specialization:</Label>
          <select
            value={filterSpec}
            onChange={(e) => setFilterSpec(e.target.value)}
            className="text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground"
          >
            <option value="ALL">All Departments ({waves.length})</option>
            {specializations.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* Manual Wave Creation Modal */}
          <Dialog open={isManualOpen} onOpenChange={setIsManualOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  Create Wave
                </Button>
              }
            />
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base font-bold">Create Arrival Wave</DialogTitle>
                <DialogDescription className="text-xs">
                  Manually configure an arrival window and capacity for a medical department.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleManualCreate} className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Specialization</Label>
                  <Input
                    value={spec}
                    onChange={(e) => setSpec(e.target.value)}
                    required
                    placeholder="e.g. Cardiology"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Date (IST)</Label>
                  <Input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Window Start</Label>
                    <Input
                      type="time"
                      value={startH}
                      onChange={(e) => setStartH(e.target.value)}
                      required
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Window End</Label>
                    <Input
                      type="time"
                      value={endH}
                      onChange={(e) => setEndH(e.target.value)}
                      required
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Capacity (Patients)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={capacity}
                      onChange={(e) => setCapacity(parseInt(e.target.value, 10))}
                      required
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Stream Filter</Label>
                    <select
                      value={stream}
                      onChange={(e) => setStream(e.target.value)}
                      className="w-full text-xs bg-background border border-border rounded-md px-2.5 py-2 text-foreground"
                    >
                      <option value="ALL">All Streams</option>
                      <option value="NEW_CONSULTATION">New Consultation</option>
                      <option value="FOLLOW_UP">Follow-Up</option>
                      <option value="PRIORITY">Priority Only</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Notes (Optional)</Label>
                  <Input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Morning clinic wave"
                    className="text-xs"
                  />
                </div>

                <div className="pt-3">
                  <Button type="submit" disabled={isPending} className="w-full text-xs">
                    {isPending ? "Creating..." : "Save Draft Wave"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {/* Auto Generate Modal */}
          <Dialog open={isAutoOpen} onOpenChange={setIsAutoOpen}>
            <DialogTrigger
              render={
                <Button variant="default" size="sm" className="gap-1.5 text-xs">
                  <Sparkles className="h-3.5 w-3.5" />
                  Auto-Generate Waves
                </Button>
              }
            />
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base font-bold">Auto-Generate Daily Waves</DialogTitle>
                <DialogDescription className="text-xs">
                  Deterministically split a clinical day into sequential arrival windows for admin review.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleAutoGenerate} className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Specialization</Label>
                  <Input
                    value={autoSpec}
                    onChange={(e) => setAutoSpec(e.target.value)}
                    required
                    placeholder="e.g. Cardiology"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Target Date (IST)</Label>
                  <Input
                    type="date"
                    value={autoDate}
                    onChange={(e) => setAutoDate(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Window Length (Min)</Label>
                    <Input
                      type="number"
                      min="15"
                      max="240"
                      step="15"
                      value={windowMin}
                      onChange={(e) => setWindowMin(parseInt(e.target.value, 10))}
                      required
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Capacity Per Wave</Label>
                    <Input
                      type="number"
                      min="1"
                      value={autoCap}
                      onChange={(e) => setAutoCap(parseInt(e.target.value, 10))}
                      required
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="pt-3">
                  <Button type="submit" disabled={isPending} className="w-full text-xs">
                    {isPending ? "Generating..." : "Generate Draft Waves"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Waves Grid */}
      {filteredWaves.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <Waves className="h-10 w-10 mb-3 opacity-30 text-primary" />
            <h3 className="font-semibold text-foreground text-base">No Waves Found</h3>
            <p className="text-sm mt-1 max-w-sm">
              No arrival waves configured for the selected criteria. Create one manually or auto-generate for a department.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWaves.map((wave) => {
            const start = new Date(wave.windowStart);
            const end = new Date(wave.windowEnd);
            const fillPercent = Math.min(100, Math.round((wave.assignedCount / wave.capacity) * 100));

            return (
              <Card
                key={wave.id}
                className="overflow-hidden border-border hover:border-primary/40 transition-all shadow-xs"
              >
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                        {wave.specialization}
                      </span>
                      <h4 className="font-bold text-base text-foreground mt-0.5">
                        {formatTimeIST(start)} — {formatTimeIST(end)}
                      </h4>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTimeIST(start).split(",")[0]}
                      </span>
                    </div>

                    <Badge
                      variant={
                        wave.status === "PUBLISHED"
                          ? "success"
                          : wave.status === "CLOSED"
                          ? "outline"
                          : "warning"
                      }
                      className="text-[10px] uppercase font-semibold"
                    >
                      {wave.status}
                    </Badge>
                  </div>

                  {/* Fill Meter */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        Fill Capacity
                      </span>
                      <span className="font-semibold text-foreground">
                        {wave.assignedCount} / {wave.capacity} ({fillPercent}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          fillPercent >= 100
                            ? "bg-rose-500"
                            : fillPercent >= 75
                            ? "bg-amber-500"
                            : "bg-primary"
                        }`}
                        style={{ width: `${fillPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Performance Summary if Published */}
                  {wave.status === "PUBLISHED" && (
                    <div className="grid grid-cols-3 gap-1 pt-1 border-t border-border/60 text-center text-[10px]">
                      <div className="p-1 rounded bg-muted/30">
                        <span className="text-muted-foreground block">On Time</span>
                        <span className="font-bold text-emerald-600">{wave.onTimeCheckIns}</span>
                      </div>
                      <div className="p-1 rounded bg-muted/30">
                        <span className="text-muted-foreground block">Late</span>
                        <span className="font-bold text-rose-600">{wave.lateCheckIns}</span>
                      </div>
                      <div className="p-1 rounded bg-muted/30">
                        <span className="text-muted-foreground block">No-Show</span>
                        <span className="font-bold text-amber-600">{wave.noShows}</span>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-border">
                    <Link
                      href={`/admin/waves/${wave.id}`}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-semibold py-2 hover:bg-secondary/80 transition-colors"
                    >
                      Review & Assign Appointments
                      <ArrowRight className="h-3 w-3" />
                    </Link>
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
