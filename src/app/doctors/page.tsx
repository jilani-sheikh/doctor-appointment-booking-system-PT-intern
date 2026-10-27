import { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/env";
import { DoctorStatus, SlotStatus, Prisma } from "@/generated/prisma/client";
import { DoctorSearch } from "./doctor-search";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTimeIST } from "@/lib/time";
import {
  Calendar,
  Clock,
  GraduationCap,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
  Database,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Find Doctors & Specialists — Medrella",
  description:
    "Explore verified doctors, check real-time availability slots, and book medical consultations.",
};

const ITEMS_PER_PAGE = 9;

interface DoctorsPageProps {
  searchParams: Promise<{
    q?: string;
    specialization?: string;
    page?: string;
  }>;
}

export default async function DoctorsPage({ searchParams }: DoctorsPageProps) {
  const resolvedParams = await searchParams;
  const query = resolvedParams.q?.trim() ?? "";
  const selectedSpec = resolvedParams.specialization?.trim() ?? "";
  const pageNum = Math.max(1, parseInt(resolvedParams.page ?? "1", 10) || 1);

  if (!isDatabaseConfigured()) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-16">
        <div className="rounded-xl border border-dashed border-border p-12 text-center space-y-4 bg-muted/20">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Database className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Database Not Configured</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            The doctor directory requires a PostgreSQL database connection. Configure DATABASE_URL in your
            environment to explore live medical practitioner listings.
          </p>
        </div>
      </div>
    );
  }

  const now = new Date();

  // Construct where filter: APPROVED doctors only
  const whereClause: Prisma.DoctorWhereInput = {
    status: DoctorStatus.APPROVED,
  };

  if (query) {
    whereClause.OR = [
      { user: { name: { contains: query, mode: "insensitive" } } },
      { specialization: { contains: query, mode: "insensitive" } },
      { qualification: { contains: query, mode: "insensitive" } },
    ];
  }

  if (selectedSpec) {
    whereClause.specialization = { equals: selectedSpec, mode: "insensitive" };
  }

  type DoctorWithRelations = Prisma.DoctorGetPayload<{
    include: {
      user: {
        select: {
          name: true;
          email: true;
          image: true;
        };
      };
      availabilities: {
        select: {
          id: true;
          startTime: true;
          endTime: true;
        };
      };
    };
  }>;

  let totalCount = 0;
  let doctors: DoctorWithRelations[] = [];
  let allApproved: { specialization: string }[] = [];
  let queryFailed = false;

  try {
    const results = await Promise.all([
      db.doctor.count({ where: whereClause }),
      db.doctor.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              name: true,
              email: true,
              image: true,
            },
          },
          availabilities: {
            where: {
              startTime: { gte: now },
              status: SlotStatus.AVAILABLE,
            },
            orderBy: {
              startTime: "asc",
            },
            take: 1,
            select: {
              id: true,
              startTime: true,
              endTime: true,
            },
          },
        },
        orderBy: [{ isDemo: "desc" }, { createdAt: "desc" }],
        skip: (pageNum - 1) * ITEMS_PER_PAGE,
        take: ITEMS_PER_PAGE,
      }),
      db.doctor.findMany({
        where: { status: DoctorStatus.APPROVED },
        select: { specialization: true },
        distinct: ["specialization"],
      }),
    ]);

    totalCount = results[0];
    doctors = results[1];
    allApproved = results[2];
  } catch (error) {
    console.error("[Medrella Doctors Directory] Error loading doctors:", error);
    queryFailed = true;
  }

  if (queryFailed) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-16">
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center space-y-3">
          <Stethoscope className="h-8 w-8 text-destructive mx-auto" />
          <h2 className="text-lg font-bold text-foreground">Unable to Load Doctor Listings</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            A temporary connection issue occurred while connecting to the medical directory database. Please try
            refreshing shortly.
          </p>
        </div>
      </div>
    );
  }

  const specializations = allApproved
    .map((d) => d.specialization)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-2">
          <Stethoscope className="h-3.5 w-3.5" />
          Verified Medical Directory
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Explore Doctors & Specialists
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base mt-1">
          Browse verified healthcare providers, view available consultation slots, and book appointments.
        </p>
      </div>

      {/* Search & Filter Bar */}
      <DoctorSearch specializations={specializations} />

      {/* Doctor Grid or Empty State */}
      {doctors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center space-y-3 bg-card">
          <Stethoscope className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <h3 className="font-semibold text-foreground text-base">No Doctors Found</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            We couldn&apos;t find any approved doctors matching your search filters. Try adjusting your search query
            or resetting the specialization filter.
          </p>
          <div className="pt-2">
            <Link href="/doctors" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Reset Filters
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {doctors.map((doc) => {
            const nextSlot = doc.availabilities[0];
            const feeFormatted = Number(doc.consultationFee).toLocaleString("en-IN");

            return (
              <Card
                key={doc.id}
                className="flex flex-col justify-between overflow-hidden border-border hover:border-primary/50 transition-all shadow-xs hover:shadow-md"
              >
                <CardHeader className="pb-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <CardTitle className="text-base font-bold text-foreground">
                          Dr. {doc.user.name ?? "Practitioner"}
                        </CardTitle>
                        {doc.isDemo && (
                          <Badge variant="secondary" className="text-[10px] uppercase font-semibold">
                            Demo
                          </Badge>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs font-medium text-primary border-primary/20 bg-primary/5">
                        {doc.specialization}
                      </Badge>
                    </div>
                  </div>

                  {doc.qualification && (
                    <CardDescription className="text-xs flex items-center gap-1.5 text-muted-foreground">
                      <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                      <span>{doc.qualification}</span>
                    </CardDescription>
                  )}
                </CardHeader>

                <CardContent className="space-y-4 pt-0 flex-1 flex flex-col justify-between">
                  <div className="space-y-2 text-xs border-y border-border/60 py-3 my-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Consultation Fee</span>
                      <span className="font-semibold text-foreground text-sm">₹{feeFormatted}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Experience</span>
                      <span className="font-medium text-foreground">
                        {doc.experienceYears ? `${doc.experienceYears} Years` : "Experienced"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Next Open Slot</span>
                      <span className="font-medium text-foreground text-right truncate max-w-[170px]">
                        {nextSlot ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                            <Clock className="h-3 w-3 shrink-0" />
                            {formatDateTimeIST(nextSlot.startTime)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">No open slots</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/doctors/${doc.id}`}
                    className={buttonVariants({
                      size: "sm",
                      className: "w-full gap-2 mt-auto",
                    })}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    <span>View Profile & Slots</span>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          {pageNum > 1 && (
            <Link
              href={`/doctors?page=${pageNum - 1}${query ? `&q=${encodeURIComponent(query)}` : ""}${selectedSpec ? `&specialization=${encodeURIComponent(selectedSpec)}` : ""}`}
              className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1" })}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Link>
          )}

          <span className="text-sm text-muted-foreground">
            Page <strong className="text-foreground">{pageNum}</strong> of{" "}
            <strong className="text-foreground">{totalPages}</strong>
          </span>

          {pageNum < totalPages && (
            <Link
              href={`/doctors?page=${pageNum + 1}${query ? `&q=${encodeURIComponent(query)}` : ""}${selectedSpec ? `&specialization=${encodeURIComponent(selectedSpec)}` : ""}`}
              className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1" })}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
