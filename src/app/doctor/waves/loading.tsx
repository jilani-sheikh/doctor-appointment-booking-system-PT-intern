import { Skeleton } from "@/components/ui/skeleton";

export default function DoctorWavesLoading() {
  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8 animate-pulse">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="h-16 rounded-xl bg-muted/40" />

      <div className="h-48 rounded-xl bg-muted/30" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="h-40 rounded-xl bg-muted/30" />
          <div className="h-40 rounded-xl bg-muted/30" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="h-64 rounded-xl bg-muted/30" />
        </div>
      </div>
    </div>
  );
}
