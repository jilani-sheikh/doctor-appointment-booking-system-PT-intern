import Link from "next/link";
import { Stethoscope } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border bg-card/60 text-muted-foreground mt-auto">
      <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Stethoscope className="h-4 w-4" />
            </div>
            <span>Medrella</span>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <Link href="/" className="hover:text-primary transition-colors">
              Home
            </Link>
            <Link href="/doctors" className="hover:text-primary transition-colors">
              Find Doctors
            </Link>
            <Link href="/about" className="hover:text-primary transition-colors">
              About
            </Link>
          </div>

          <p className="text-xs text-muted-foreground text-center sm:text-right">
            &copy; {new Date().getFullYear()} Medrella Appointment System. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
