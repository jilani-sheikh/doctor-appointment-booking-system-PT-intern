import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { WavesList } from "./waves-list";
import { toWaveDto, type SerializedWave } from "@/lib/serializers";
import { calculateWaveMetrics, type WaveTarget } from "@/lib/waves";
import { Waves, ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Wave-Based Arrival Management — Admin Portal",
  description: "Configure clinical arrival waves, balance patient arrivals, and track expected versus actual arrivals.",
};

export default async function AdminWavesPage() {
  await requireRole(Role.ADMIN);

  // Fetch all waves with appointment counts
  const rawWaves = await db.wave.findMany({
    orderBy: { windowStart: "asc" },
    include: {
      _count: { select: { appointments: true } },
      appointments: {
        select: {
          status: true,
          checkedInAt: true,
        },
      },
    },
  });

  // Unique specializations from doctors in the database
  const doctorSpecializations = await db.doctor.findMany({
    select: { specialization: true },
    distinct: ["specialization"],
  });
  const specializations = doctorSpecializations.map((d) => d.specialization);

  const serializedWaves: SerializedWave[] = rawWaves.map((wave) => {
    const target: WaveTarget = {
      id: wave.id,
      specialization: wave.specialization,
      windowStart: wave.windowStart,
      windowEnd: wave.windowEnd,
      capacity: wave.capacity,
      stream: wave.stream,
      status: wave.status,
    };
    const metrics = calculateWaveMetrics(target, wave.appointments);
    return toWaveDto(wave, metrics);
  });

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
      <div className="border-b border-border pb-5">
        <div className="flex items-center gap-2">
          <Link
            href="/admin/dashboard"
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Admin Portal
          </Link>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1 flex items-center gap-2.5">
          <Waves className="h-7 w-7 text-primary" />
          Wave Arrival Management
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Batch patient arrivals into discrete operational windows to smooth clinic flow and minimize waiting room congestion.
        </p>
      </div>

      <WavesList
        waves={serializedWaves}
        specializations={specializations}
      />
    </div>
  );
}
