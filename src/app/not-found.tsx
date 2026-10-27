import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft, Stethoscope, FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16 sm:py-24">
      <div className="text-center max-w-md mx-auto space-y-4">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center">
          <FileQuestion className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Page Not Found
        </h1>
        <p className="text-sm text-muted-foreground">
          The requested page or medical resource could not be found. It may have moved or been decommissioned.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <Link href="/" className={buttonVariants({ variant: "default", size: "sm", className: "w-full sm:w-auto gap-2" })}>
            <ArrowLeft className="h-4 w-4" />
            <span>Return to Home</span>
          </Link>
          <Link href="/doctors" className={buttonVariants({ variant: "outline", size: "sm", className: "w-full sm:w-auto gap-2" })}>
            <Stethoscope className="h-4 w-4" />
            <span>Find Doctors</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
