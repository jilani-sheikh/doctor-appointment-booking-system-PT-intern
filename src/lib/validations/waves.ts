import { z } from "zod";
import { VisitStream } from "@/generated/prisma/enums";

export const doctorWaveSettingsSchema = z.object({
  waveWindowMinutes: z.coerce.number().int().min(5, "Window minutes must be at least 5").max(240, "Window minutes cannot exceed 240"),
  waveCapacity: z.coerce.number().int().min(1, "Capacity must be at least 1").max(50, "Capacity cannot exceed 50"),
  arrivalBufferMinutes: z.coerce.number().int().min(0, "Arrival buffer cannot be negative").max(120, "Buffer cannot exceed 120 minutes"),
  autoPublishWaves: z.boolean().default(false),
});

export type DoctorWaveSettingsInput = z.infer<typeof doctorWaveSettingsSchema>;

export const generateDoctorWavesSchema = z.object({
  dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  publishNow: z.boolean().default(false),
});

export type GenerateDoctorWavesInput = z.infer<typeof generateDoctorWavesSchema>;

export const createDoctorManualWaveSchema = z
  .object({
    dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    windowStartTime: z.string().regex(/^\d{2}:\d{2}$/, "Window start time must be in HH:mm format"),
    windowEndTime: z.string().regex(/^\d{2}:\d{2}$/, "Window end time must be in HH:mm format"),
    capacity: z.coerce.number().int().min(1, "Capacity must be at least 1 patient").max(50, "Capacity cannot exceed 50"),
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

export type CreateDoctorManualWaveInput = z.infer<typeof createDoctorManualWaveSchema>;

export const publishDoctorWaveSchema = z.object({
  waveId: z.string().min(1, "Wave ID is required"),
});

export type PublishDoctorWaveInput = z.infer<typeof publishDoctorWaveSchema>;

export const reassignDoctorWaveAppointmentSchema = z.object({
  appointmentId: z.string().min(1, "Appointment ID is required"),
  targetWaveId: z.string().nullable(),
});

export type ReassignDoctorWaveAppointmentInput = z.infer<typeof reassignDoctorWaveAppointmentSchema>;

export const deleteDoctorDraftWaveSchema = z.object({
  waveId: z.string().min(1, "Wave ID is required"),
});

export type DeleteDoctorDraftWaveInput = z.infer<typeof deleteDoctorDraftWaveSchema>;

// Retain legacy schemas for any backward compatibility
export const createWaveSchema = createDoctorManualWaveSchema;
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

export const reassignWaveAppointmentSchema = reassignDoctorWaveAppointmentSchema;
export type ReassignWaveAppointmentInput = z.infer<typeof reassignWaveAppointmentSchema>;
