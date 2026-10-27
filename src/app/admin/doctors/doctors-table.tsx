"use client";

import { useState, useTransition } from "react";
import { updateDoctorApprovalAction } from "@/lib/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import type { DoctorStatus } from "@/generated/prisma/client";

export interface SerializedAdminDoctor {
  id: string;
  name: string;
  email: string;
  specialization: string;
  qualification?: string | null;
  consultationFee: number;
  experienceYears?: number | null;
  status: DoctorStatus;
  isDemo: boolean;
  createdAt: string;
}

interface DoctorsTableProps {
  doctors: SerializedAdminDoctor[];
}

export function DoctorsTable({ doctors }: DoctorsTableProps) {
  const [filter, setFilter] = useState<DoctorStatus | "ALL">("PENDING");
  const [isPending, startTransition] = useTransition();

  const filteredDoctors = doctors.filter((doc) => {
    if (filter === "ALL") return true;
    return doc.status === filter;
  });

  const handleUpdate = (doctorId: string, targetStatus: "APPROVED" | "REJECTED") => {
    startTransition(async () => {
      const res = await updateDoctorApprovalAction(doctorId, targetStatus);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.error || "Failed to update doctor verification status.");
      }
    });
  };

  const getStatusBadge = (status: DoctorStatus) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="warning" className="text-[10px] uppercase">Pending</Badge>;
      case "APPROVED":
        return <Badge variant="success" className="text-[10px] uppercase">Approved</Badge>;
      case "REJECTED":
        return <Badge variant="destructive" className="text-[10px] uppercase">Rejected</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] uppercase">{status}</Badge>;
    }
  };

  const pendingCount = doctors.filter((d) => d.status === "PENDING").length;
  const approvedCount = doctors.filter((d) => d.status === "APPROVED").length;
  const rejectedCount = doctors.filter((d) => d.status === "REJECTED").length;

  return (
    <div className="space-y-6">
      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("PENDING")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${
            filter === "PENDING"
              ? "bg-amber-500 text-white border-amber-600 shadow-xs"
              : "bg-background text-muted-foreground border-border hover:bg-muted"
          }`}
        >
          Pending Verification ({pendingCount})
        </button>

        <button
          type="button"
          onClick={() => setFilter("APPROVED")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${
            filter === "APPROVED"
              ? "bg-emerald-600 text-white border-emerald-700 shadow-xs"
              : "bg-background text-muted-foreground border-border hover:bg-muted"
          }`}
        >
          Approved Doctors ({approvedCount})
        </button>

        <button
          type="button"
          onClick={() => setFilter("REJECTED")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${
            filter === "REJECTED"
              ? "bg-destructive text-destructive-foreground border-destructive shadow-xs"
              : "bg-background text-muted-foreground border-border hover:bg-muted"
          }`}
        >
          Rejected ({rejectedCount})
        </button>

        <button
          type="button"
          onClick={() => setFilter("ALL")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${
            filter === "ALL"
              ? "bg-primary text-primary-foreground border-primary shadow-xs"
              : "bg-background text-muted-foreground border-border hover:bg-muted"
          }`}
        >
          All Practitioners ({doctors.length})
        </button>
      </div>

      {/* Table */}
      <Card className="border-border shadow-xs overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="font-semibold text-xs">Doctor</TableHead>
              <TableHead className="font-semibold text-xs">Specialization</TableHead>
              <TableHead className="font-semibold text-xs">Fee</TableHead>
              <TableHead className="font-semibold text-xs">Experience</TableHead>
              <TableHead className="font-semibold text-xs">Status</TableHead>
              <TableHead className="text-right font-semibold text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDoctors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                  No doctors found with status {filter.toLowerCase()}.
                </TableCell>
              </TableRow>
            ) : (
              filteredDoctors.map((doc) => (
                <TableRow key={doc.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-foreground text-sm">
                          Dr. {doc.name}
                        </span>
                        {doc.isDemo && (
                          <Badge variant="secondary" className="text-[10px] uppercase font-bold">
                            Demo
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground block">{doc.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <span className="text-xs font-medium text-foreground">{doc.specialization}</span>
                      {doc.qualification && (
                        <span className="text-[11px] text-muted-foreground block">{doc.qualification}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-semibold text-foreground">
                    ₹{doc.consultationFee.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {doc.experienceYears ? `${doc.experienceYears} Years` : "—"}
                  </TableCell>
                  <TableCell>{getStatusBadge(doc.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {doc.status !== "APPROVED" && (
                        <Button
                          variant="default"
                          size="xs"
                          disabled={isPending}
                          onClick={() => handleUpdate(doc.id, "APPROVED")}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Approve
                        </Button>
                      )}

                      {doc.status !== "REJECTED" && (
                        <Button
                          variant="destructive"
                          size="xs"
                          disabled={isPending}
                          onClick={() => handleUpdate(doc.id, "REJECTED")}
                          className="gap-1"
                        >
                          <XCircle className="h-3 w-3" />
                          Reject
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
