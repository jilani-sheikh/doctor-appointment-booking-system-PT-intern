"use client";

import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";

export function PrintPrescriptionButton() {
  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => window.print()}
      >
        <Printer className="h-4 w-4" />
        Print
      </Button>
      <Button
        variant="default"
        size="sm"
        className="gap-2"
        onClick={() => window.print()}
      >
        <Download className="h-4 w-4" />
        Save as PDF
      </Button>
    </div>
  );
}
