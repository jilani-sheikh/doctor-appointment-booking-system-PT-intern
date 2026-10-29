import { z } from "zod";
import { getTodayISTDateString } from "@/lib/time";

export const bulkSlotSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be in YYYY-MM-DD format"),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be in YYYY-MM-DD format"),
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Select at least one day of the week"),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Start time must be in HH:MM format"),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "End time must be in HH:MM format"),
    duration: z
      .number()
      .refine((val) => [15, 30, 45, 60].includes(val), "Duration must be 15, 30, 45, or 60 minutes"),
  })
  .refine((data) => {
    const today = getTodayISTDateString();
    return data.startDate >= today;
  }, {
    message: "Start date cannot be in the past",
    path: ["startDate"],
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  })
  .refine((data) => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 31;
  }, {
    message: "Date range cannot exceed 31 days",
    path: ["endDate"],
  })
  .refine((data) => {
    return data.endTime > data.startTime;
  }, {
    message: "End time must be after start time",
    path: ["endTime"],
  });

export type BulkSlotInput = z.infer<typeof bulkSlotSchema>;

// Aliases for compatibility
export const slotGenerationSchema = bulkSlotSchema;
export type SlotGenerationInput = BulkSlotInput;
