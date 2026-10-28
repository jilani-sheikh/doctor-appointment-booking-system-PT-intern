import { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { DoctorsTable } from "./doctors-table";
import { toAdminDoctorDto, type SerializedAdminDoctor } from "@/lib/serializers";
import { Stethoscope, ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Doctor Verifications — Admin Console",
  description: "Review, approve, or reject medical practitioners on Medrella.",
};

export default async function AdminDoctorsPage() {
  await requireRole(Role.ADMIN);

  const rawDoctors = await db.doctor.findMany({
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    orderBy: [
      { status: "asc" }, // PENDING first
      { createdAt: "desc" },
    ],
  });

  const doctors: SerializedAdminDoctor[] = rawDoctors.map(toAdminDoctorDto);

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/admin/dashboard"
              className={buttonVariants({
                variant: "ghost",
                size: "xs",
                className: "text-muted-foreground hover:text-foreground pl-0 gap-1",
              })}
            >
              <ArrowLeft className="h-3 w-3" />
              Back to Overview
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Stethoscope className="h-7 w-7 text-primary" />
            Doctor Verifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Evaluate doctor credentials and toggle clinical practice authorization on Medrella.
          </p>
        </div>
      </div>

      <DoctorsTable doctors={doctors} />
    </div>
  );
}
