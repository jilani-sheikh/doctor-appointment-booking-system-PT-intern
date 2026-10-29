import { z } from "zod";
import { VisitStream } from "@/generated/prisma/client";

export const createWaveSchema = z
  .object({
    specialization: z.string().min(1, "Department / specialization is required"),
    dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    windowStartTime: z.string().regex(/^\d{2}:\d{2}$/, "Window start time must be in HH:mm format"),
    windowEndTime: z.string().regex(/^\d{2}:\d{2}$/, "Window end time must be in HH:mm format"),
    capacity: z.coerce.number().int().min(1, "Capacity must be at least 1 patient"),
    stream: z.nativeEnum(VisitStream).optional().nullable(),
    notes: z.string().max(500).optional(),
  })
  .refine(
    (data) => data.windowEndTime > data.windowStartTime,
    {
      message: "Window end time must be after start time.",
      path: ["windowEndTime"],
    }
  );

export type CreateWaveInput = z.infer<typeof createWaveSchema>;

export const autoGenerateWavesSchema = z.object({
  specialization: z.string().min(1, "Department / specialization is required"),
  dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  windowMinutes: z.coerce.number().int().min(15).max(360).default(60),
  defaultCapacity: z.coerce.number().int().min(1).default(4),
  earliestTimeStr: z.string().regex(/^\d{2}:\d{2}$/).optional().default("09:00"),
  latestTimeStr: z.string().regex(/^\d{2}:\d{2}$/).optional().default("17:00"),
});

export type AutoGenerateWavesInput = z.input<typeof autoGenerateWavesSchema>;

export const publishWaveSchema = z.object({
  waveId: z.string().min(1, "Wave ID is required"),
  acknowledgeOverflow: z.boolean().default(false),
});

export type PublishWaveInput = z.infer<typeof publishWaveSchema>;

export const reassignWaveAppointmentSchema = z.object({
  appointmentId: z.string().min(1, "Appointment ID is required"),
  targetWaveId: z.string().nullable(),
});

export type ReassignWaveAppointmentInput = z.infer<typeof reassignWaveAppointmentSchema>;
