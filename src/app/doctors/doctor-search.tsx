"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";

interface DoctorSearchProps {
  specializations: string[];
}

export function DoctorSearch({ specializations }: DoctorSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentQ = searchParams.get("q") ?? "";
  const currentSpec = searchParams.get("specialization") ?? "";

  const [query, setQuery] = useState(currentQ);
  const [selectedSpec, setSelectedSpec] = useState(currentSpec);
  const [isPending, startTransition] = useTransition();

  const applyFilters = (newQ: string, newSpec: string) => {
    const params = new URLSearchParams();
    if (newQ.trim()) params.set("q", newQ.trim());
    if (newSpec.trim()) params.set("specialization", newSpec.trim());
    params.set("page", "1");

    startTransition(() => {
      router.push(`/doctors?${params.toString()}`);
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters(query, selectedSpec);
  };

  const handleSpecChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSpec = e.target.value;
    setSelectedSpec(nextSpec);
    applyFilters(query, nextSpec);
  };

  const handleClear = () => {
    setQuery("");
    setSelectedSpec("");
    startTransition(() => {
      router.push("/doctors");
    });
  };

  const hasFilters = Boolean(currentQ || currentSpec);

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-xs space-y-3">
      <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search doctors by practitioner name or discipline..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-4 bg-background"
          />
        </div>

        <div className="flex gap-2 sm:w-72">
          <div className="relative flex-1">
            <select
              aria-label="Filter by specialization"
              value={selectedSpec}
              onChange={handleSpecChange}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">All Specializations</option>
              {specializations.map((spec) => (
                <option key={spec} value={spec}>
                  {spec}
                </option>
              ))}
            </select>
          </div>

          <Button type="submit" disabled={isPending} size="sm" className="px-4 shrink-0">
            Search
          </Button>

          {hasFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClear}
              className="px-2.5 shrink-0 text-muted-foreground hover:text-foreground"
              title="Clear filters"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
