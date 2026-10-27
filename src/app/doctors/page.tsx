import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Stethoscope } from "lucide-react";

export default function DoctorsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16 sm:py-24 flex items-center justify-center">
      <Card className="w-full text-center p-6 sm:p-10 border-border/80 shadow-sm">
        <CardHeader className="flex flex-col items-center pb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
            <Stethoscope className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold text-foreground">Find Doctors</CardTitle>
          <CardDescription className="text-sm text-muted-foreground mt-2 max-w-md">
            Doctor search, profile listings, and specialization filters are coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 flex flex-col items-center gap-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
            Feature in progress
          </div>
          <Link
            href="/"
            className={buttonVariants({
              variant: "outline",
              className: "mt-4 flex items-center gap-2",
            })}
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Return Home</span>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
