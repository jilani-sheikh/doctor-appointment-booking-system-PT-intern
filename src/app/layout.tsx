import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Medrella — Doctor Appointment Booking Application",
  description:
    "A secure, reliable platform connecting patients with doctors for streamlined healthcare appointment scheduling.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    console.warn("[RootLayout] Failed to resolve current user, defaulting to null:", err);
  }

  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col font-sans bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
        <Navbar user={user} />
        <main className="flex-1 flex flex-col">{children}</main>
        <Footer />
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
