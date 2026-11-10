"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleBlockSlotAction, deleteSlotAction } from "@/lib/actions/slots";
import { cancelAllSlotsForDateAction } from "@/lib/actions/slots";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { Ban, CheckCircle2, Clock, Trash2, Calendar } from "lucide-react";
import { formatSlotRange, getISTDateString } from "@/lib/time";
import type { SerializedSlot } from "@/lib/serializers";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { expandAvailabilityAction, shrinkAvailabilityAction } from "@/lib/actions/slots";
import { calculateElasticRange, type ElasticEdge, type ElasticOperation } from "@/lib/scheduling";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export type { SerializedSlot };

interface SlotListProps {
  slotsGrouped: Record<string, SerializedSlot[]>;
  generatedGroups: Record<string, GeneratedGroup[]>;
}

interface GeneratedGroup {
  id: string;
  scheduleId: string;
  type: "WAVE" | "STREAM";
  startTime: string;
  endTime: string;
  durationMinutes: number;
  capacity: number;
}

function ElasticDialog({ group, operation, open, onOpenChange, isPending, onComplete }: {
  group: GeneratedGroup;
  operation: ElasticOperation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onComplete: (result: { success: boolean; message?: string; error?: string; affectedAppointmentsCount?: number }) => void;
}) {
  const [edge, setEdge] = useState<ElasticEdge>("END");
  const [steps, setSteps] = useState(1);
  const [applyToFuture, setApplyToFuture] = useState(false);
  const [, startTransition] = useTransition();
  const current = { startTime: new Date(group.startTime), endTime: new Date(group.endTime) };
  let preview: ReturnType<typeof calculateElasticRange> | null = null;
  let validationError = "";
  try {
    preview = calculateElasticRange(current, edge, steps, group.durationMinutes, operation);
    if ((preview.endTime.getTime() - preview.startTime.getTime()) % (group.durationMinutes * 60_000) !== 0) {
      validationError = "The new range must stay divisible by the duration.";
    }
  } catch (error) {
    validationError = error instanceof Error ? error.message : "Invalid range.";
  }
  const submit = () => {
    if (!preview || validationError) return;
    const date = getISTDateString(new Date(group.startTime));
    const action = operation === "SHRINK" ? shrinkAvailabilityAction : expandAvailabilityAction;
    startTransition(async () => {
      const result = await action({ scheduleId: group.scheduleId, date, edge, steps, applyToFuture });
      onComplete(result);
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{operation === "SHRINK" ? "Shrink" : "Expand"} {group.type === "WAVE" ? "Wave" : "Stream"} window</DialogTitle>
          <DialogDescription>Adjust this generated window in steps of {group.durationMinutes} minutes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor={`edge-${group.id}`}>Edge</Label><select id={`edge-${group.id}`} className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={edge} onChange={(event) => setEdge(event.target.value as ElasticEdge)}><option value="START">Start</option><option value="END">End</option></select></div>
            <div><Label htmlFor={`steps-${group.id}`}>Steps</Label><Input id={`steps-${group.id}`} type="number" min={1} max={100} value={steps} onChange={(event) => setSteps(Number(event.target.value))} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applyToFuture} onChange={(event) => setApplyToFuture(event.target.checked)} />Apply to all future dates of this recurring schedule</label>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p>New range: {preview ? `${formatSlotRange(preview.startTime.toISOString(), preview.endTime.toISOString())}` : "Invalid"}</p>
            <p className="text-muted-foreground">{preview ? `${operation === "SHRINK" ? "Removed" : "Added"} ${steps} interval${steps === 1 ? "" : "s"} · ${steps * group.capacity} seat${steps * group.capacity === 1 ? "" : "s"} affected` : validationError}</p>
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={isPending || Boolean(validationError) || !preview} onClick={submit}>Confirm</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SlotList({ slotsGrouped, generatedGroups }: SlotListProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleToggleBlock = (slotId: string) => {
    startTransition(async () => {
      const res = await toggleBlockSlotAction(slotId);
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to update slot.");
      }
    });
  };

  const handleDelete = (slotId: string) => {
    if (!confirm("Are you sure you want to delete this slot?")) return;
    startTransition(async () => {
      const res = await deleteSlotAction(slotId);
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to delete slot.");
      }
    });
  };

  const handleCancelAll = (date: string, slotCount: number) => {
    if (!confirm(`Cancel all ${slotCount} slot(s) for this date?`)) return;
    startTransition(async () => {
      const result = await cancelAllSlotsForDateAction(date);
      if (!result.success && "requiresConfirmation" in result) {
        if (!confirm(`${result.activeAppointments?.length ?? 0} booked appointment(s) will be cancelled and refunded where applicable. Continue?`)) return;
        const confirmed = await cancelAllSlotsForDateAction(date, true);
        if (!confirmed.success) {
          toast.error(confirmed.error || "Failed to cancel all slots.");
        } else {
          toast.success("All slots for this date were cancelled.");
          router.refresh();
        }
      } else if (!result.success) {
        toast.error(result.error || "Failed to cancel all slots.");
      } else {
        toast.success("All slots for this date were cancelled.");
        router.refresh();
      }
    });
  };

  const dates = Object.keys(slotsGrouped);

  if (dates.length === 0) {
    return (
      <Card className="border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <Calendar className="h-10 w-10 mb-3 opacity-40 text-primary" />
          <h3 className="font-semibold text-foreground text-base">No Upcoming Slots</h3>
          <p className="text-sm mt-1 max-w-sm">
            You do not have any upcoming consultation slots. Use the form above to generate slots.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Upcoming Schedule ({dates.reduce((acc, d) => acc + slotsGrouped[d].length, 0)} total slots)
        </h2>
      </div>

      {dates.map((dateKey) => {
        const slots = slotsGrouped[dateKey];
        const date = getISTDateString(new Date(slots[0].startTime));
        return (
          <Card key={dateKey} className="overflow-hidden border-border shadow-xs">
            <CardHeader className="bg-muted/40 py-3 px-4 border-b border-border/60">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  {dateKey}
                </span>
                <span className="text-xs text-muted-foreground font-medium">
                  {slots.length} slot{slots.length > 1 ? "s" : ""}
                </span>
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => handleCancelAll(date, slots.length)}
                >
                  Cancel all slots
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {(generatedGroups[dateKey] ?? []).map((group) => <ElasticControls key={group.id} group={group} isPending={isPending} router={router} />)}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {slots.map((slot) => {
                  const range = formatSlotRange(slot.startTime, slot.endTime);

                  return (
                    <div
                      key={slot.id}
                      className={`min-w-0 overflow-hidden p-3 rounded-lg border flex flex-col justify-between gap-2.5 transition-all ${
                        slot.status === "AVAILABLE"
                          ? "bg-card border-border hover:border-primary/40"
                          : slot.status === "BLOCKED"
                          ? "bg-muted/50 border-amber-500/30 text-muted-foreground"
                          : "bg-blue-50/50 dark:bg-blue-950/20 border-blue-500/30"
                      }`}
                    >
                      <div className="min-w-0 flex flex-col items-start gap-2">
                        <span className="max-w-full text-sm font-semibold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
                          {range}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Capacity: {slot.capacity}
                        </span>
                        {slot.status === "AVAILABLE" && (
                          <Badge variant="success" className="text-[10px] uppercase">
                            Available
                          </Badge>
                        )}
                        {slot.status === "BLOCKED" && (
                          <Badge variant="warning" className="text-[10px] uppercase">
                            Blocked
                          </Badge>
                        )}
                        {slot.status === "BOOKED" && (
                          <Badge variant="default" className="text-[10px] uppercase bg-blue-600">
                            Booked
                          </Badge>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="w-full min-w-0 flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/50">
                        {slot.status === "AVAILABLE" && (
                          <>
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={isPending}
                              onClick={() => handleToggleBlock(slot.id)}
                              className="min-w-0 flex-1 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-xs"
                            >
                              <Ban className="h-3 w-3 mr-1" />
                              Block
                            </Button>
                            <Button
                              variant="destructive"
                              size="xs"
                              disabled={isPending}
                              onClick={() => handleDelete(slot.id)}
                              className="px-2"
                              aria-label="Delete Slot"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}

                        {slot.status === "BLOCKED" && (
                          <>
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={isPending}
                              onClick={() => handleToggleBlock(slot.id)}
                              className="min-w-0 flex-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Unblock
                            </Button>
                            <Button
                              variant="destructive"
                              size="xs"
                              disabled={isPending}
                              onClick={() => handleDelete(slot.id)}
                              className="px-2"
                              aria-label="Delete Slot"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}

                        {slot.status === "BOOKED" && (
                          <span className="text-[11px] text-muted-foreground italic py-0.5">
                            Active appointment scheduled
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ElasticControls({ group, isPending, router }: { group: GeneratedGroup; isPending: boolean; router: ReturnType<typeof useRouter> }) {
  const [operation, setOperation] = useState<ElasticOperation | null>(null);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
      <span className="text-sm font-medium">{group.type === "WAVE" ? "Wave" : "Stream"} window · {formatSlotRange(group.startTime, group.endTime)}</span>
      <div className="flex gap-2">
        <Button size="xs" variant="outline" disabled={isPending} onClick={() => setOperation("SHRINK")}>Shrink</Button>
        <Button size="xs" variant="outline" disabled={isPending} onClick={() => setOperation("EXPAND")}>Expand</Button>
      </div>
      {operation && <ElasticDialog group={group} operation={operation} open onOpenChange={(open) => !open && setOperation(null)} isPending={isPending} onComplete={(result) => {
        if (result.success) { toast.success(result.message ?? "Availability updated."); setOperation(null); router.refresh(); }
        else toast.error(result.error ?? "Unable to update availability.");
      }} />}
    </div>
  );
}
