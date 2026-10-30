-- AlterTable
ALTER TABLE "patients" ADD COLUMN "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "whatsapp_opt_in_at" TIMESTAMP(3);
