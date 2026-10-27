import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, ChevronRight, Clock, ShieldCheck, Stethoscope, Users } from "lucide-react";

export default function HomePage() {
  const benefits = [
    {
      icon: Users,
      title: "Practitioner Directory",
      description:
        "Explore qualified medical professionals and specialists with clear details on their disciplines and consultation slots.",
    },
    {
      icon: Calendar,
      title: "Real-Time Slot Availability",
      description:
        "Check up-to-date schedule openings directly, avoiding unnecessary coordination calls and scheduling delays.",
    },
    {
      icon: ShieldCheck,
      title: "Conflict-Free Scheduling",
      description:
        "Built on relational database constraints ensuring that each slot is uniquely reserved without double-booking.",
    },
    {
      icon: Clock,
      title: "Streamlined Booking",
      description:
        "Reserve and manage consultation appointments with an organized, transparent booking workflow.",
    },
  ];

  const steps = [
    {
      number: "01",
      title: "Find a Specialist",
      description: "Browse the directory of verified doctors across medical disciplines.",
    },
    {
      number: "02",
      title: "Select an Open Slot",
      description: "Pick an available consultation date and time that matches your schedule.",
    },
    {
      number: "03",
      title: "Confirm Appointment",
      description: "Review appointment details and lock in your reservation securely.",
    },
  ];

  return (
    <div className="flex flex-col items-center w-full">
      {/* Hero Section */}
      <section className="w-full py-16 md:py-24 lg:py-28 bg-gradient-to-b from-secondary/40 via-background to-background border-b border-border/40">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1 text-xs font-medium text-primary mb-6">
            <span className="flex h-2 w-2 rounded-full bg-primary" />
            Healthcare Scheduling Platform
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground max-w-3xl mx-auto leading-tight sm:leading-tight lg:leading-tight">
            Seamless Doctor Appointments, <span className="text-primary">Simplified.</span>
          </h1>

          <p className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Medrella provides a structured platform connecting patients with healthcare professionals.
            Discover practitioners, check available consultation hours, and book visits with confidence.
          </p>

          {/* Call to Actions */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/doctors"
              className={buttonVariants({
                size: "lg",
                className: "w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm flex items-center justify-center gap-2",
              })}
            >
              <Stethoscope className="h-4 w-4" />
              <span>Find a Doctor</span>
            </Link>

            <Link
              href="/book"
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "w-full sm:w-auto border-border text-foreground hover:bg-muted flex items-center justify-center gap-2",
              })}
            >
              <Calendar className="h-4 w-4" />
              <span>Book an Appointment</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="w-full py-16 sm:py-20 bg-background">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Designed for Convenience and Reliability
            </h2>
            <p className="mt-3 text-sm sm:text-base text-muted-foreground">
              A modern architecture focused on reliable scheduling, accurate availability, and privacy.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {benefits.map((benefit, idx) => {
              const Icon = benefit.icon;
              return (
                <Card key={idx} className="border border-border/80 bg-card hover:border-primary/40 transition-all hover:shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-base font-semibold text-foreground">
                      {benefit.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm text-muted-foreground leading-relaxed">
                      {benefit.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section className="w-full py-16 bg-muted/40 border-t border-border/60">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6">
          <div className="text-center max-w-xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              How Medrella Works
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A straightforward process from practitioner discovery to confirmed consultation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, idx) => (
              <div key={idx} className="flex flex-col items-center text-center p-6 rounded-xl bg-card border border-border/60">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm mb-4">
                  {step.number}
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/about"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Learn more about Medrella
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
