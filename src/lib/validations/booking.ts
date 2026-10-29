import { z } from "zod";

export const bookAppointmentSchema = z.object({
  availabilityId: z.string().min(1, "Availability slot ID is required"),
  stream: z
    .enum(["NEW_CONSULTATION", "FOLLOW_UP"])
    .default("NEW_CONSULTATION"),
  reason: z
    .string()
    .max(500, "Reason for consultation cannot exceed 500 characters")
    .optional()
    .transform((val) => (val?.trim() ? val.trim() : undefined)),
});

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
