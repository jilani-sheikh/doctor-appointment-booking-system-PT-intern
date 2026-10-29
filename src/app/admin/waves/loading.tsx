import { Skeleton } from "@/components/ui/skeleton";

export default function AdminWavesLoading() {
  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
      <div className="space-y-2 border-b border-border pb-5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
