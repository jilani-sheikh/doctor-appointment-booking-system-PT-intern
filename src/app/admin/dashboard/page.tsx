import { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Stethoscope, Database, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Admin Dashboard — Medrella",
  description: "Platform administration and verification control center.",
};

export default async function AdminDashboardPage() {
  const user = await requireRole(Role.ADMIN);

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" /> Administrative Console
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            System Overview — {user.name ?? "Administrator"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Role: <span className="font-semibold text-foreground">ADMIN</span> (Authenticated via Verified Google Sign-In)
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Doctor Verification Process */}
        <Card className="shadow-sm border-border bg-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-primary" />
                Doctor Approvals
              </CardTitle>
              <span className="text-[11px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded">
                Coming soon (Phase 7)
              </span>
            </div>
            <CardDescription className="text-xs">
              Review and verify newly registered medical practitioners
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="p-4 rounded-lg bg-muted/40 border border-border/60 space-y-2">
              <p className="font-medium text-foreground text-xs flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Phase 2 Verification Workflow:
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Dedicated admin approval dashboards and reject/approve actions will be built in Phase 7.
                Currently in Phase 2, administrators can inspect and approve doctors directly via Prisma Studio:
              </p>
              <code className="block bg-card px-3 py-1.5 rounded text-xs border border-border font-mono text-primary">
                npm run db:studio
              </code>
            </div>
          </CardContent>
        </Card>

        {/* Database & Architecture Card */}
        <Card className="shadow-sm border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Infrastructure Status
            </CardTitle>
            <CardDescription className="text-xs">
              Neon PostgreSQL & Prisma ORM connection topology
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <span className="text-xs text-muted-foreground">Database Engine</span>
              <span className="text-xs font-semibold text-foreground">PostgreSQL on Neon</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <span className="text-xs text-muted-foreground">ORM Framework</span>
              <span className="text-xs font-semibold text-foreground">Prisma 7 (@prisma/adapter-neon)</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <span className="text-xs text-muted-foreground">Runtime Connection</span>
              <span className="text-xs font-semibold text-foreground">WebSocket Pooled (DATABASE_URL)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Migration Connection</span>
              <span className="text-xs font-semibold text-foreground">Direct Non-Pooled (DIRECT_URL)</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
