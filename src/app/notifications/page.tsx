import { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toNotificationDto, type SerializedNotification } from "@/lib/serializers";
import { NotificationsView } from "./notifications-view";
import { Bell } from "lucide-react";

export const metadata: Metadata = {
  title: "Notifications — Medrella",
  description: "View updates regarding your appointments, schedule changes, and queue delays.",
};

export default async function NotificationsPage() {
  const user = await requireUser();

  const rawNotifications = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const notifications: SerializedNotification[] = rawNotifications.map(toNotificationDto);
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="container mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <Bell className="h-7 w-7 text-primary" />
          Notifications
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review consultation updates, absence alerts, queue delays, and arrival windows.
        </p>
      </div>

      <NotificationsView
        notifications={notifications}
        unreadCount={unreadCount}
      />
    </div>
  );
}
