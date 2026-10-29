import { z } from "zod";

export const doctorTimeOffSchema = z
  .object({
    startAt: z.string().min(1, "Absence start time is required"),
    endAt: z.string().min(1, "Absence end time is required"),
    reason: z
      .string()
      .max(500, "Reason cannot exceed 500 characters")
      .optional()
      .transform((val) => (val?.trim() ? val.trim() : undefined)),
  })
  .refine(
    (data) => {
      const start = new Date(data.startAt).getTime();
      const end = new Date(data.endAt).getTime();
      return end > start;
    },
    {
      message: "Absence end time must be after the start time.",
      path: ["endAt"],
    }
  )
  .refine(
    (data) => {
      const start = new Date(data.startAt).getTime();
      const end = new Date(data.endAt).getTime();
      const maxDurationMs = 30 * 24 * 60 * 60 * 1000; // max 30 days
      return end - start <= maxDurationMs;
    },
    {
      message: "Absence duration cannot exceed 30 days.",
      path: ["endAt"],
    }
  );

export type DoctorTimeOffInput = z.infer<typeof doctorTimeOffSchema>;

export const deleteDoctorTimeOffSchema = z.object({
  id: z.string().min(1, "Time-off ID is required"),
});

export type DeleteDoctorTimeOffInput = z.infer<typeof deleteDoctorTimeOffSchema>;
