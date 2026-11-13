import { redirect } from "next/navigation";
import type { SerializedWave } from "@/lib/serializers";
import { AppointmentStatus } from "@/generated/prisma/client";

export interface SerializedDoctorWaveWithAppointments extends SerializedWave {
  appointments: Array<{
    id: string;
    patientId: string;
    patientName: string;
    patientPhone?: string | null;
    status: AppointmentStatus;
    stream: string;
    slotStartTime: string;
    slotEndTime: string;
    checkedInAt?: string | null;
  }>;
}

export interface SerializedUnassignedAppointment {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string | null;
  status: AppointmentStatus;
  stream: string;
  slotStartTime: string;
  slotEndTime: string;
  checkedInAt?: string | null;
}

export default function DoctorWavesPage() {
  redirect("/doctor/arrival-windows");
}
