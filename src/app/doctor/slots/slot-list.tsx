"use client";

import { useTransition } from "react";
import { toggleBlockSlotAction, deleteSlotAction } from "@/lib/actions/slots";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { Ban, CheckCircle2, Clock, Trash2, Calendar } from "lucide-react";
import { formatTimeIST } from "@/lib/time";
import type { SerializedSlot } from "@/lib/serializers";
export type { SerializedSlot };

interface SlotListProps {
  slotsGrouped: Record<string, SerializedSlot[]>;
}

export function SlotList({ slotsGrouped }: SlotListProps) {
  const [isPending, startTransition] = useTransition();

  const handleToggleBlock = (slotId: string) => {
    startTransition(async () => {
      const res = await toggleBlockSlotAction(slotId);
      if (res.success) {
        toast.success(res.message);
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
      } else {
        toast.error(res.error || "Failed to delete slot.");
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
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {slots.map((slot) => {
                  const startStr = formatTimeIST(new Date(slot.startTime));
                  const endStr = formatTimeIST(new Date(slot.endTime));

                  return (
                    <div
                      key={slot.id}
                      className={`p-3 rounded-lg border flex flex-col justify-between gap-2.5 transition-all ${
                        slot.status === "AVAILABLE"
                          ? "bg-card border-border hover:border-primary/40"
                          : slot.status === "BLOCKED"
                          ? "bg-muted/50 border-amber-500/30 text-muted-foreground"
                          : "bg-blue-50/50 dark:bg-blue-950/20 border-blue-500/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold tracking-tight">
                          {startStr} - {endStr}
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
                      <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
                        {slot.status === "AVAILABLE" && (
                          <>
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={isPending}
                              onClick={() => handleToggleBlock(slot.id)}
                              className="text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 flex-1 text-xs"
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
                              className="text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 flex-1 text-xs"
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
