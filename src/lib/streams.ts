import { VisitStream, Role } from "@/generated/prisma/enums";

export interface StreamConfig {
  value: VisitStream;
  label: string;
  description: string;
  badgeVariant: "default" | "secondary" | "destructive" | "outline" | "warning" | "success";
  badgeClassName?: string;
  patientSelectable: boolean;
}

export const STREAM_CONFIGS: Record<VisitStream, StreamConfig> = {
  [VisitStream.NEW_CONSULTATION]: {
    value: VisitStream.NEW_CONSULTATION,
    label: "New Consultation",
    description: "First-time clinical evaluation for a new condition or assessment.",
    badgeVariant: "secondary",
    badgeClassName: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    patientSelectable: true,
  },
  [VisitStream.FOLLOW_UP]: {
    value: VisitStream.FOLLOW_UP,
    label: "Follow-Up",
    description: "Subsequent consultation for ongoing treatment or test review.",
    badgeVariant: "secondary",
    badgeClassName: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    patientSelectable: true,
  },
  [VisitStream.PRIORITY]: {
    value: VisitStream.PRIORITY,
    label: "Priority",
    description: "Urgent or clinically expedited review designated by practitioner or administrator.",
    badgeVariant: "destructive",
    badgeClassName: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-300 dark:border-rose-800 font-semibold",
    patientSelectable: false,
  },
};

/**
 * Validates whether the role can assign the requested stream.
 * Patients can only select NEW_CONSULTATION or FOLLOW_UP.
 * PRIORITY is strictly restricted to DOCTOR and ADMIN.
 */
export function canAssignStream(stream: VisitStream, role: Role): boolean {
  if (stream === VisitStream.PRIORITY) {
    return role === Role.DOCTOR || role === Role.ADMIN;
  }
  return true;
}

export function getStreamLabel(stream?: VisitStream | null): string {
  if (!stream) return "Consultation";
  return STREAM_CONFIGS[stream]?.label ?? stream;
}
