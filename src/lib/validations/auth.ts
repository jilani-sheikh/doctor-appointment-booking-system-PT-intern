import { z } from "zod";

/**
 * Shared constant list of medical specializations supported across Medrella.
 */
export const SPECIALIZATIONS = [
  "Cardiology",
  "General Physician",
  "Dermatology",
  "Orthopedics",
  "Pediatrics",
  "ENT",
  "Gynecology",
  "Neurology",
  "Dentistry",
] as const;

export type Specialization = (typeof SPECIALIZATIONS)[number];

export const GENDERS = ["Male", "Female", "Other", "Prefer not to say"] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * Schema for user sign-in via credentials.
 */
export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password cannot exceed 72 characters"),
});

export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Schema for user registration via email and password.
 */
export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name cannot exceed 100 characters"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Email is required")
      .email("Please enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(72, "Password cannot exceed 72 characters")
      .regex(
        /^(?=.*[A-Za-z])(?=.*\d)/,
        "Password must contain at least one letter and one number"
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Schema for Patient profile onboarding.
 */
export const patientOnboardingSchema = z.object({
  role: z.literal("PATIENT"),
  dateOfBirth: z
    .string()
    .min(1, "Date of birth is required")
    .refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date <= new Date();
    }, "Date of birth cannot be in the future"),
  gender: z.enum(GENDERS, {
    errorMap: () => ({ message: "Please select a valid gender option" }),
  }),
  phone: z
    .string()
    .trim()
    .min(10, "Phone number must be at least 10 digits")
    .max(15, "Phone number is too long")
    .regex(
      /^(?:\+91\s?|91\s?|0)?[6-9]\d{9}$/,
      "Please enter a valid 10-digit Indian phone number"
    ),
  whatsappOptIn: z.boolean().default(false),
});

export type PatientOnboardingInput = z.infer<typeof patientOnboardingSchema>;

/**
 * Schema for Doctor profile onboarding.
 */
export const doctorOnboardingSchema = z.object({
  role: z.literal("DOCTOR"),
  specialization: z.enum(SPECIALIZATIONS, {
    errorMap: () => ({ message: "Please select a valid specialization" }),
  }),
  qualification: z
    .string()
    .trim()
    .min(2, "Qualification is required (e.g. MBBS, MD)")
    .max(100, "Qualification cannot exceed 100 characters"),
  consultationFee: z.coerce
    .number({ invalid_type_error: "Consultation fee must be a number" })
    .positive("Consultation fee must be greater than 0")
    .max(50000, "Consultation fee cannot exceed ₹50,000"),
  experienceYears: z.coerce
    .number({ invalid_type_error: "Years of experience must be a number" })
    .int("Years of experience must be a whole number")
    .min(0, "Years of experience cannot be negative")
    .max(70, "Please enter a valid number of years"),
  bio: z
    .string()
    .trim()
    .max(1000, "Bio cannot exceed 1,000 characters")
    .optional()
    .or(z.literal("")),
});

export type DoctorOnboardingInput = z.infer<typeof doctorOnboardingSchema>;

/**
 * Union onboarding schema.
 */
export const onboardingSchema = z.discriminatedUnion("role", [
  patientOnboardingSchema,
  doctorOnboardingSchema,
]);

export type OnboardingInput = z.infer<typeof onboardingSchema>;
