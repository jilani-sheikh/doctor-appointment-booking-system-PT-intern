"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { blockScheduleDateAction, cancelScheduleAction, unblockScheduleDateAction } from "@/lib/actions/slots";

interface ScheduleItem {
  id: string;
  type: string;
  recurrence: string;
  startDate: string;
  endDate: string;
  capacity: number;
  exceptions: Array<{ date: string; reason?: string | null }>;
}

export function ScheduleList({ schedules }: { schedules: ScheduleItem[] }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  if (schedules.length === 0) return <p className="text-sm text-muted-foreground">No generated schedules yet.</p>;
  return (
    <div className="space-y-3">
      {schedules.map((schedule) => (
        <div key={schedule.id} className="rounded-lg border p-3 text-sm space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">
              {schedule.type === "WAVE" ? "Wave" : "Stream"} · {schedule.recurrence === "ONCE" ? `Non-recurring · Overrides recurring availability on ${schedule.startDate}` : "Recurring"} · capacity {schedule.capacity}
            </span>
            <Button size="xs" variant="outline" disabled={isPending} onClick={() => startTransition(async () => {
              const result = await cancelScheduleAction(schedule.id);
              if (!result.success && "requiresConfirmation" in result) {
                if (confirm(`${result.activeAppointments?.length ?? 0} active appointment(s) will be cancelled and refunded. Continue?`)) {
                  const confirmed = await cancelScheduleAction(schedule.id, true);
                  if (!confirmed.success) toast.error(confirmed.error);
                  else {
                    toast.success("Future schedule cancelled.");
                    router.refresh();
                  }
                }
              } else if (!result.success) toast.error(result.error);
              else {
                toast.success("Future schedule cancelled.");
                router.refresh();
              }
            })}>Cancel schedule</Button>
          </div>
          <p className="text-muted-foreground">{schedule.startDate} to {schedule.endDate}</p>
          <div className="flex flex-wrap gap-2">
            <input aria-label="Date to block" type="date" id={`block-${schedule.id}`} />
            <Button size="xs" disabled={isPending} onClick={() => {
              const date = (document.getElementById(`block-${schedule.id}`) as HTMLInputElement).value;
              if (!date) return toast.error("Choose a date.");
              startTransition(async () => {
                const result = await blockScheduleDateAction(schedule.id, date);
                if (!result.success && "requiresConfirmation" in result) {
                  if (confirm(`${result.activeAppointments?.length ?? 0} active appointment(s) will be cancelled and refunded. Continue?`)) await blockScheduleDateAction(schedule.id, date, true);
                } else if (!result.success) toast.error(result.error);
                else toast.success("Date blocked.");
              });
            }}>Block date</Button>
          </div>
          {schedule.exceptions.length > 0 && <div className="flex flex-wrap gap-2">{schedule.exceptions.map((exception) => (
            <Button key={exception.date} size="xs" variant="secondary" disabled={isPending} onClick={() => startTransition(async () => {
              const result = await unblockScheduleDateAction(schedule.id, exception.date);
              if (!result.success) toast.error(result.error); else toast.success("Date unblocked.");
            })}>{exception.reason === "Overridden by non-recurring schedule" ? `Overridden ${exception.date}` : `Unblock ${exception.date}`}</Button>
          ))}</div>}
        </div>
      ))}
    </div>
  );
}
