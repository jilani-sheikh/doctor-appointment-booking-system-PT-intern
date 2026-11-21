"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ClinicalTimelineEvent, ClinicalTimelineSource } from "@/lib/medical-records";
import { Calendar, FileText, Pill, Stethoscope, User } from "lucide-react";

interface ClinicalTimelineListProps {
  events: readonly ClinicalTimelineEvent[];
  emptyMessage?: string;
}

export function ClinicalTimelineList({
  events,
  emptyMessage = "No clinical timeline events recorded yet.",
}: ClinicalTimelineListProps) {
  const [sourceFilter, setSourceFilter] = useState<"ALL" | ClinicalTimelineSource>("ALL");

  const filtered = useMemo(() => {
    if (sourceFilter === "ALL") return events;
    return events.filter((ev) => ev.source === sourceFilter);
  }, [events, sourceFilter]);

  const sourceStyle = (source: ClinicalTimelineSource) => {
    switch (source) {
      case "PATIENT_REPORTED":
        return {
          badgeClass: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
          icon: <User className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />,
        };
      case "CLINIC_CONSULTATION":
        return {
          badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
          icon: <Stethoscope className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />,
        };
      case "ISSUED_PRESCRIPTION":
        return {
          badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
          icon: <Pill className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />,
        };
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { key: "ALL", label: `All (${events.length})` },
            {
              key: "PATIENT_REPORTED",
              label: `Patient-Reported (${events.filter((e) => e.source === "PATIENT_REPORTED").length})`,
            },
            {
              key: "CLINIC_CONSULTATION",
              label: `Consultations (${events.filter((e) => e.source === "CLINIC_CONSULTATION").length})`,
            },
            {
              key: "ISSUED_PRESCRIPTION",
              label: `Prescriptions (${events.filter((e) => e.source === "ISSUED_PRESCRIPTION").length})`,
            },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.key}
            type="button"
            size="xs"
            variant={sourceFilter === tab.key ? "default" : "outline"}
            onClick={() => setSourceFilter(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed border">
          <CardContent className="p-8 text-center text-xs text-muted-foreground">
            <FileText className="h-7 w-7 mx-auto mb-2 opacity-40" />
            {emptyMessage}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((item) => {
            const style = sourceStyle(item.source);
            return (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-card p-3.5 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-muted">
                      {style.icon}
                    </span>
                    <span className="font-semibold text-sm text-foreground">{item.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] font-semibold ${style.badgeClass}`}>
                      {item.sourceLabel}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {item.category}
                    </Badge>
                  </div>
                </div>
                {item.subtitle && (
                  <p className="text-xs font-medium text-muted-foreground">{item.subtitle}</p>
                )}
                {item.details && (
                  <p className="text-xs text-foreground/85 bg-muted/30 rounded-md p-2 border border-border/50 whitespace-pre-wrap">
                    {item.details}
                  </p>
                )}
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {item.dateLabel}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
