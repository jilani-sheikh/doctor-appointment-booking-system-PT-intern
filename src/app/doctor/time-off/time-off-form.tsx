"use client";

import { useState, useTransition } from "react";
import { createDoctorTimeOffAction } from "@/lib/actions/time-off";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CalendarOff } from "lucide-react";

export function DoctorTimeOffForm() {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("18:00");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      toast.error("Please specify both start and end dates.");
      return;
    }

    const startAt = new Date(`${startDate}T${startTime}:00Z`).toISOString();
    const endAt = new Date(`${endDate}T${endTime}:00Z`).toISOString();

    if (new Date(endAt) <= new Date(startAt)) {
      toast.error("Absence end date/time must be strictly after the start.");
      return;
    }

    startTransition(async () => {
      const res = await createDoctorTimeOffAction({
        startAt,
        endAt,
        reason: reason.trim() || undefined,
      });

      if (res.success) {
        toast.success(res.message);
        setReason("");
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card className="border-border shadow-xs">
      <CardHeader>
        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
          <CalendarOff className="h-5 w-5 text-primary" />
          Schedule Practitioner Absence
        </CardTitle>
        <CardDescription className="text-xs">
          Record planned leaves or emergencies. Available slots in this range will be blocked, and any affected patients will be notified to reschedule.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Absence Start Date & Time</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  className="text-xs"
                />
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Absence End Date & Time</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  className="text-xs"
                />
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Reason for Absence (Shared with Patients)</Label>
            <Textarea
              placeholder="e.g., Medical conference attendance, personal leave, or clinical duty."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-xs"
              rows={2}
            />
          </div>

          <div className="pt-2">
            <Button type="submit" disabled={isPending} className="w-full sm:w-auto text-xs">
              {isPending ? "Recording Absence..." : "Record Absence & Block Slots"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
