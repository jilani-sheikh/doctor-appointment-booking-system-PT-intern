import Link from "next/link";
import { AuthButton } from "./auth-button";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Activity, Menu, Stethoscope, LayoutDashboard } from "lucide-react";
import { type NavUser, toNavUser } from "@/lib/serializers";

interface NavbarProps {
  user?: NavUser | null;
}

export function Navbar({ user }: NavbarProps) {
  const navUser = toNavUser(user);

  const dashboardUrl =
    navUser?.role === "PATIENT"
      ? "/patient/dashboard"
      : navUser?.role === "DOCTOR"
      ? "/doctor/dashboard"
      : navUser?.role === "ADMIN"
      ? "/admin/dashboard"
      : "/onboarding";

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/doctors", label: "Find Doctors" },
    { href: "/about", label: "About" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/70 bg-card/90 backdrop-blur-md">
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 font-bold text-xl text-primary hover:opacity-90 transition-opacity">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Stethoscope className="h-5 w-5" />
          </div>
          <span className="tracking-tight text-foreground font-semibold text-xl">
            Med<span className="text-primary">rella</span>
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              {link.label}
            </Link>
          ))}
          {navUser && (
            <Link
              href={dashboardUrl}
              className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
          )}

          {/* Role-specific Desktop Navigation */}
          {navUser?.role === "PATIENT" && (
            <Link
              href="/patient/appointments"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              Appointments
            </Link>
          )}

          {navUser?.role === "DOCTOR" && (
            <>
              <Link
                href="/doctor/appointments"
                className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
              >
                Appointments
              </Link>
              <Link
                href="/doctor/slots"
                className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
              >
                Slots
              </Link>
            </>
          )}

          {navUser?.role === "ADMIN" && (
            <Link
              href="/admin/doctors"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              Doctor Verifications
            </Link>
          )}
        </nav>

        {/* Right Section: Auth & Mobile Menu */}
        <div className="flex items-center gap-3">
          <AuthButton user={navUser} />

          {/* Mobile Navigation Drawer */}
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="Open mobile menu" className="text-muted-foreground hover:text-foreground">
                    <Menu className="h-5 w-5" />
                  </Button>
                }
              />
              <SheetContent side="right" className="w-72 bg-card border-l border-border p-6">
                <SheetHeader className="text-left mb-6">
                  <SheetTitle className="flex items-center gap-2 text-primary font-bold text-lg">
                    <Activity className="h-5 w-5" />
                    <span>Medrella Menu</span>
                  </SheetTitle>
                </SheetHeader>
                <div className="flex flex-col space-y-4">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="text-base font-medium text-foreground/80 hover:text-primary py-2 px-1 rounded-md transition-colors"
                    >
                      {link.label}
                    </Link>
                  ))}

                  {navUser?.role === "PATIENT" && (
                    <Link
                      href="/patient/appointments"
                      className="text-base font-medium text-foreground/80 hover:text-primary py-2 px-1 rounded-md transition-colors"
                    >
                      Appointments
                    </Link>
                  )}

                  {navUser?.role === "DOCTOR" && (
                    <>
                      <Link
                        href="/doctor/appointments"
                        className="text-base font-medium text-foreground/80 hover:text-primary py-2 px-1 rounded-md transition-colors"
                      >
                        Appointments
                      </Link>
                      <Link
                        href="/doctor/slots"
                        className="text-base font-medium text-foreground/80 hover:text-primary py-2 px-1 rounded-md transition-colors"
                      >
                        Slots
                      </Link>
                    </>
                  )}

                  {navUser?.role === "ADMIN" && (
                    <Link
                      href="/admin/doctors"
                      className="text-base font-medium text-foreground/80 hover:text-primary py-2 px-1 rounded-md transition-colors"
                    >
                      Doctor Verifications
                    </Link>
                  )}

                  {navUser && (
                    <Link
                      href={dashboardUrl}
                      className="text-base font-semibold text-primary py-2 px-1 rounded-md transition-colors flex items-center gap-2"
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      <span>My Dashboard</span>
                    </Link>
                  )}
                  <div className="pt-4 border-t border-border space-y-2">
                    <Link
                      href="/book"
                      className="inline-flex w-full items-center justify-center rounded-md bg-secondary text-secondary-foreground text-sm font-semibold py-2.5 hover:bg-secondary/80 transition-colors"
                    >
                      Book Appointment
                    </Link>

                    {navUser ? (
                      <div className="pt-2">
                        <SignOutButton
                          variant="outline"
                          className="w-full justify-center text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                        />
                      </div>
                    ) : (
                      <Link
                        href="/sign-in"
                        className="inline-flex w-full items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold py-2.5 hover:bg-primary/90 transition-colors"
                      >
                        Sign In
                      </Link>
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
