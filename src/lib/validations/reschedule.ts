import { z } from "zod";

export const rescheduleAppointmentSchema = z.object({
  appointmentId: z.string().min(1, "Appointment ID is required"),
  newAvailabilityId: z.string().min(1, "New slot ID is required"),
  reason: z.string().max(500).optional(),
});

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const waitlistEntrySchema = z.object({
  doctorId: z.string().min(1, "Doctor ID is required"),
  earliestDate: z.string().min(1, "Earliest date is required"),
  latestDate: z.string().min(1, "Latest date is required"),
});

export type WaitlistEntryInput = z.infer<typeof waitlistEntrySchema>;

export const setPriorityStreamSchema = z.object({
  appointmentId: z.string().min(1, "Appointment ID is required"),
});

export type SetPriorityStreamInput = z.infer<typeof setPriorityStreamSchema>;
