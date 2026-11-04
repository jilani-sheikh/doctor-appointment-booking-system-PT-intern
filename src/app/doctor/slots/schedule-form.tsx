"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { createScheduleAction, previewScheduleAction } from "@/lib/actions/slots";
import { RECURRENCE_LABELS, SCHEDULE_TYPE_LABELS, type ScheduleInput } from "@/lib/scheduling";

export function ScheduleForm() {
  const [type, setType] = useState<"WAVE" | "STREAM">("WAVE");
  const [recurrence, setRecurrence] = useState<"ONCE" | "RECURRING">("RECURRING");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [capacity, setCapacity] = useState(3);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewInput, setPreviewInput] = useState<ScheduleInput | null>(null);
  const [isPending, startTransition] = useTransition();

  const buildInput = () => ({
    type,
    recurrence,
    startDate,
    endDate: recurrence === "ONCE" ? startDate : endDate,
    daysOfWeek: recurrence === "ONCE" ? [] : [0, 1, 2, 3, 4, 5, 6],
    startMinute: Number(startTime.split(":")[0]) * 60 + Number(startTime.split(":")[1]),
    endMinute: Number(endTime.split(":")[0]) * 60 + Number(endTime.split(":")[1]),
    durationMinutes,
    capacity,
  });

  const handlePreview = () => {
    startTransition(async () => {
      const result = await previewScheduleAction(buildInput());
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (!("dates" in result) || !("conflicts" in result)) {
        toast.error("Unable to preview this schedule.");
        return;
      }
      const dates = result.dates ?? [];
      const conflicts = result.conflicts ?? [];
      const overrides = "overrides" in result ? (result.overrides ?? []) : [];
      const skipped = "skippedDates" in result ? (result.skippedDates ?? []) : [];
      setPreview(`${result.count ?? 0} bookable row(s) across ${dates.length} date(s)${conflicts.length ? `; ${conflicts.length} conflict(s)` : ""}${overrides.length ? `. ${overrides.map((item) => item.message).join(" ")}` : ""}${skipped.length ? ` ${skipped.length} date(s) skipped because a Non-recurring schedule already exists.` : ""}`);
      setPreviewInput(buildInput());
    });
  };

  const handleCreate = () => {
    startTransition(async () => {
      const result = await createScheduleAction(previewInput ?? buildInput());
      if (!result.success && "requiresConfirmation" in result) {
        if (confirm(`${result.activeAppointments?.length ?? 0} active appointment(s) will be cancelled with refund before the Wave override is created. Continue?`)) {
          const confirmed = await createScheduleAction(previewInput ?? buildInput(), true);
          if (!confirmed.success) toast.error(confirmed.error);
          else {
            toast.success(`Created ${confirmed.createdCount} availability row(s) and applied the override.`);
            setPreview(null);
            setPreviewInput(null);
          }
        }
        return;
      }
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Created ${result.createdCount} availability row(s).`);
      setPreview(null);
      setPreviewInput(null);
    });
  };

  return (
    <Card>
      <CardHeader><CardTitle>Generate Availability</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" aria-label={SCHEDULE_TYPE_LABELS.WAVE} variant={type === "WAVE" ? "default" : "outline"} onClick={() => setType("WAVE")}>{SCHEDULE_TYPE_LABELS.WAVE}</Button>
          <Button type="button" aria-label={SCHEDULE_TYPE_LABELS.STREAM} variant={type === "STREAM" ? "default" : "outline"} onClick={() => setType("STREAM")}>{SCHEDULE_TYPE_LABELS.STREAM}</Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" aria-label={RECURRENCE_LABELS.RECURRING} variant={recurrence === "RECURRING" ? "default" : "outline"} onClick={() => setRecurrence("RECURRING")}>{RECURRENCE_LABELS.RECURRING}</Button>
          <Button type="button" aria-label={RECURRENCE_LABELS.ONCE} variant={recurrence === "ONCE" ? "default" : "outline"} onClick={() => setRecurrence("ONCE")}>{RECURRENCE_LABELS.ONCE}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="schedule-start">Start date</Label><Input id="schedule-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></div>
          <div><Label htmlFor="schedule-end">End date</Label><Input id="schedule-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={recurrence === "ONCE"} required /></div>
          <div><Label htmlFor="schedule-start-time">Start time</Label><Input id="schedule-start-time" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div>
          <div><Label htmlFor="schedule-end-time">End time</Label><Input id="schedule-end-time" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
          <div><Label htmlFor="schedule-duration">Duration (minutes)</Label><Input id="schedule-duration" type="number" min={1} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></div>
          <div><Label htmlFor="schedule-capacity">Capacity</Label><Input id="schedule-capacity" type="number" min={1} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} /></div>
        </div>
        {type === "STREAM" && <p className="text-xs text-muted-foreground">One Stream window; appointment intervals are calculated on the duration grid and capacity applies to the window.</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={handlePreview}>Preview</Button>
          <Button type="button" disabled={isPending || !preview} onClick={handleCreate}>Save schedule</Button>
        </div>
        {preview && <p className="text-sm text-muted-foreground">{preview}</p>}
      </CardContent>
    </Card>
  );
}
