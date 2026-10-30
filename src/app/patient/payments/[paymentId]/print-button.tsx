"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export function PrintReceiptButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 print:hidden"
      onClick={() => window.print()}
    >
      <Printer className="h-4 w-4" />
      Print Receipt
    </Button>
  );
}
