import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Info } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16 sm:py-24 flex items-center justify-center">
      <Card className="w-full text-center p-6 sm:p-10 border-border/80 shadow-sm">
        <CardHeader className="flex flex-col items-center pb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
            <Info className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold text-foreground">About Medrella</CardTitle>
          <CardDescription className="text-sm text-muted-foreground mt-2 max-w-md">
            Full platform overview, mission details, and healthcare partner information are coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 flex flex-col items-center gap-4">
          <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
            Medrella is an internship project dedicated to providing reliable, modern appointment scheduling
            for doctors and patients.
          </p>
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
