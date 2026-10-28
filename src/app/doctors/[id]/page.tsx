import { notFound } from "next/navigation";
import { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { DoctorStatus, SlotStatus } from "@/generated/prisma/client";
import { DoctorBookingSlots } from "./doctor-booking-slots";
import { toPublicSlotDto, type SerializedPublicSlot } from "@/lib/serializers";
import { formatDateIST } from "@/lib/time";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  ArrowLeft,
  Briefcase,
  GraduationCap,
  Database,
} from "lucide-react";

interface DoctorDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({ params }: DoctorDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isDatabaseConfigured()) {
    return { title: "Doctor Profile — Medrella" };
  }
  try {
    const doctor = await db.doctor.findUnique({
      where: { id },
      include: { user: { select: { name: true } } },
    });
    if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
      return { title: "Doctor Not Found — Medrella" };
    }
    return {
      title: `Dr. ${doctor.user.name ?? "Practitioner"} (${doctor.specialization}) — Medrella`,
      description: doctor.bio ?? `Book an appointment with Dr. ${doctor.user.name}.`,
    };
  } catch {
    return { title: "Doctor Profile — Medrella" };
  }
}

export default async function DoctorDetailPage({ params }: DoctorDetailPageProps) {
  const { id } = await params;

  if (!isDatabaseConfigured()) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-16">
        <div className="rounded-xl border border-dashed border-border p-12 text-center space-y-4 bg-muted/20">
          <Database className="h-10 w-10 text-primary mx-auto" />
          <h2 className="text-xl font-bold text-foreground">Database Not Configured</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Doctor profile and live slot booking require an active database configuration.
          </p>
        </div>
      </div>
    );
  }

  interface SlotQueryItem {
    id: string;
    startTime: Date;
    endTime: Date;
  }

  let doctor = null;
  let rawSlots: SlotQueryItem[] = [];
  let currentUser = null;

  try {
    currentUser = await getCurrentUser();

    const now = new Date();
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    doctor = await db.doctor.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    if (!doctor || doctor.status !== DoctorStatus.APPROVED) {
      notFound();
    }

    rawSlots = await db.availability.findMany({
      where: {
        doctorId: id,
        status: SlotStatus.AVAILABLE,
        startTime: {
          gte: now,
          lte: fourteenDaysFromNow,
        },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
      },
      orderBy: {
        startTime: "asc",
      },
    });
  } catch (error: unknown) {
    // If notFound() was thrown, rethrow so Next.js handles 404
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      (error as { digest: string }).digest === "NEXT_NOT_FOUND"
    ) {
      throw error;
    }
    console.error("[Medrella Doctor Detail] Failed to query doctor:", error);
    notFound();
  }

  // Group slots by formatted IST date string
  const slotsGrouped: Record<string, SerializedPublicSlot[]> = {};
  for (const slot of rawSlots) {
    const dateKey = formatDateIST(slot.startTime, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    if (!slotsGrouped[dateKey]) {
      slotsGrouped[dateKey] = [];
    }

    slotsGrouped[dateKey].push(toPublicSlotDto(slot));
  }

  const feeNumber = Number(doctor.consultationFee);
  const doctorName = doctor.user.name ?? "Practitioner";

  return (
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-8">
      {/* Back button */}
      <div>
        <Link
          href="/doctors"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "text-muted-foreground hover:text-foreground gap-1.5 pl-0",
          })}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to All Doctors</span>
        </Link>
      </div>

      {/* Doctor Header Banner */}
      <Card className="overflow-hidden border-border bg-gradient-to-br from-card via-card to-secondary/20 shadow-xs">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Dr. {doctorName}
                </span>
                {doctor.isDemo && (
                  <Badge variant="secondary" className="text-xs font-semibold uppercase">
                    Demo Practitioner
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="default" className="text-xs font-medium">
                  {doctor.specialization}
                </Badge>
                {doctor.qualification && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <GraduationCap className="h-3.5 w-3.5" />
                    {doctor.qualification}
                  </span>
                )}
              </div>

              {doctor.bio && (
                <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed pt-1">
                  {doctor.bio}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:items-end justify-between self-stretch shrink-0 bg-background/80 sm:bg-transparent p-4 sm:p-0 rounded-lg border sm:border-0 border-border">
              <div className="sm:text-right">
                <span className="text-xs text-muted-foreground">Consultation Fee</span>
                <p className="text-2xl font-bold text-foreground text-primary flex items-center sm:justify-end">
                  ₹{feeNumber.toLocaleString("en-IN")}
                </p>
              </div>

              <div className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5" />
                <span>
                  {doctor.experienceYears ? `${doctor.experienceYears} Years Clinical Experience` : "Verified Practitioner"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Slot Booking Component */}
      <DoctorBookingSlots
        doctorId={doctor.id}
        doctorName={doctorName}
        specialization={doctor.specialization}
        consultationFee={feeNumber}
        slotsGrouped={slotsGrouped}
        currentUserRole={currentUser?.role ?? null}
        isAuthenticated={Boolean(currentUser)}
      />
    </div>
  );
}
