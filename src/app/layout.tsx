import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUser } from "@/lib/auth";
import { toNavUser, toNotificationDto, type SerializedNotification } from "@/lib/serializers";
import { isDatabaseConfigured } from "@/lib/env";
import { db } from "@/lib/db";
import { scheduleOpportunisticMaintenance } from "@/lib/maintenance";
import { unstable_rethrow } from "next/navigation";

export const runtime = "nodejs";

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
  let unreadNotificationsCount = 0;
  let recentNotifications: SerializedNotification[] = [];

  try {
    const currentUser = await getCurrentUser();
    user = toNavUser(currentUser);

    if (user && isDatabaseConfigured()) {
      scheduleOpportunisticMaintenance();
      try {
        const [count, rawNotifications] = await Promise.all([
          db.notification.count({
            where: { userId: user.id, readAt: null },
          }),
          db.notification.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
        ]);
        unreadNotificationsCount = count;
        recentNotifications = rawNotifications.map(toNotificationDto);
      } catch (err) {
        console.warn("[RootLayout] Failed to query notifications, degrading to empty:", err);
      }
    }
  } catch (err) {
    unstable_rethrow(err);
    console.warn("[RootLayout] Failed to resolve current user, defaulting to null:", err);
  }

  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col font-sans bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
        <Navbar
          user={user}
          unreadNotificationsCount={unreadNotificationsCount}
          recentNotifications={recentNotifications}
        />
        <main className="flex-1 flex flex-col">{children}</main>
        <Footer />
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
