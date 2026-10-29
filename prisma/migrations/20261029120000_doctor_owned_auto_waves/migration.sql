-- AlterTable
ALTER TABLE "doctors" ADD COLUMN     "arrival_buffer_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "auto_publish_waves" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wave_capacity" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "wave_window_minutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "waves" ADD COLUMN     "doctor_id" TEXT;

-- CreateIndex
CREATE INDEX "waves_doctor_id_window_start_idx" ON "waves"("doctor_id", "window_start");

-- AddForeignKey
ALTER TABLE "waves" ADD CONSTRAINT "waves_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
