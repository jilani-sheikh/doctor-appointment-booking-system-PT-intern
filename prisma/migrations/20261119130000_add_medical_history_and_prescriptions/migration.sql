-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRESCRIPTION_ISSUED';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AllergyCategory" AS ENUM ('MEDICINE', 'FOOD', 'ENVIRONMENTAL', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ConditionStatus" AS ENUM ('ONGOING', 'RESOLVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "PastMedicalEntryType" AS ENUM ('ILLNESS', 'DIAGNOSIS', 'PROCEDURE', 'HOSPITALIZATION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "patient_medical_profiles" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "blood_group" TEXT,
    "lifestyle_notes" TEXT,
    "other_medical_notes" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_medical_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "patient_allergies" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "category" "AllergyCategory" NOT NULL,
    "allergen" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" "AllergySeverity" NOT NULL DEFAULT 'MODERATE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "patient_conditions" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "diagnosed_date" TIMESTAMP(3),
    "status" "ConditionStatus" NOT NULL DEFAULT 'ONGOING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "patient_medications" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "medicine_name" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "prescribed_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "patient_past_medical_entries" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "entry_type" "PastMedicalEntryType" NOT NULL,
    "title" TEXT NOT NULL,
    "date_or_year" TEXT,
    "recorded_date" TIMESTAMP(3),
    "facility" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_past_medical_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "patient_surgeries" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "procedure_name" TEXT NOT NULL,
    "date_or_year" TEXT,
    "surgery_date" TIMESTAMP(3),
    "hospital_or_clinic" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_surgeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "patient_family_histories" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_family_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prescriptions" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" TEXT,
    "appointment_id" TEXT,
    "idempotency_key" TEXT,
    "diagnosis" TEXT NOT NULL,
    "doctor_name_snapshot" TEXT NOT NULL,
    "doctor_specialization_snapshot" TEXT,
    "prescribed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "general_instructions" TEXT,
    "lifestyle_advice" TEXT,
    "follow_up_recommendation" TEXT,
    "follow_up_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prescription_medicines" (
    "id" TEXT NOT NULL,
    "prescription_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "medicine_name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "route" TEXT,
    "frequency" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "quantity" TEXT,
    "instructions" TEXT,
    "notes" TEXT,

    CONSTRAINT "prescription_medicines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "patient_medical_profiles_patient_id_key" ON "patient_medical_profiles"("patient_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "patient_allergies_patient_id_idx" ON "patient_allergies"("patient_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "patient_conditions_patient_id_idx" ON "patient_conditions"("patient_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "patient_medications_patient_id_idx" ON "patient_medications"("patient_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "patient_past_medical_entries_patient_id_idx" ON "patient_past_medical_entries"("patient_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "patient_surgeries_patient_id_idx" ON "patient_surgeries"("patient_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "patient_family_histories_patient_id_idx" ON "patient_family_histories"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "prescriptions_idempotency_key_key" ON "prescriptions"("idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prescriptions_patient_id_prescribed_at_idx" ON "prescriptions"("patient_id", "prescribed_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prescriptions_doctor_id_prescribed_at_idx" ON "prescriptions"("doctor_id", "prescribed_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prescriptions_appointment_id_idx" ON "prescriptions"("appointment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prescription_medicines_prescription_id_sort_order_idx" ON "prescription_medicines"("prescription_id", "sort_order");

-- AddForeignKey
ALTER TABLE "patient_medical_profiles" ADD CONSTRAINT "patient_medical_profiles_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_past_medical_entries" ADD CONSTRAINT "patient_past_medical_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_surgeries" ADD CONSTRAINT "patient_surgeries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_family_histories" ADD CONSTRAINT "patient_family_histories_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_medicines" ADD CONSTRAINT "prescription_medicines_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
