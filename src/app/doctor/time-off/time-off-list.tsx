"use client";

import { useTransition } from "react";
import { deleteDoctorTimeOffAction } from "@/lib/actions/time-off";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { CalendarOff, Trash2 } from "lucide-react";
import { formatDateTimeIST } from "@/lib/time";
import type { SerializedDoctorTimeOff } from "@/lib/serializers";

interface DoctorTimeOffListProps {
  timeOffs: SerializedDoctorTimeOff[];
}

export function DoctorTimeOffList({ timeOffs }: DoctorTimeOffListProps) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = (id: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this absence? Any unbooked slots that were blocked by this absence will be restored back to Available."
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await deleteDoctorTimeOffAction({ id });
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error);
      }
    });
  };

  if (timeOffs.length === 0) {
    return (
      <Card className="border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <CalendarOff className="h-8 w-8 mb-2 opacity-40 text-primary" />
          <h3 className="font-semibold text-foreground text-sm">No Recorded Absences</h3>
          <p className="text-xs mt-1 max-w-sm">
            You do not have any scheduled leaves or time-off periods recorded.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {timeOffs.map((item) => {
        const start = new Date(item.startAt);
        const end = new Date(item.endAt);

        return (
          <Card key={item.id} className="border-border shadow-xs hover:border-primary/40 transition-all">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      {formatDateTimeIST(start)} — {formatDateTimeIST(end)}
                    </span>
                    {item.isPast ? (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        Past
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-[10px] uppercase bg-amber-600">
                        Active / Upcoming
                      </Badge>
                    )}
                  </div>

                  {item.reason && (
                    <p className="text-xs text-muted-foreground">
                      <strong>Reason: </strong>
                      {item.reason}
                    </p>
                  )}
                </div>

                {!item.isPast && (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleDelete(item.id)}
                    className="gap-1 text-xs text-destructive hover:bg-destructive/10 border-destructive/20 self-start sm:self-auto"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Cancel Absence & Restore Slots
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
