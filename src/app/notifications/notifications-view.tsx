"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/lib/actions/notifications";
import { formatDateTimeIST } from "@/lib/time";
import type { SerializedNotification } from "@/lib/serializers";
import { toast } from "sonner";

interface NotificationsViewProps {
  notifications: SerializedNotification[];
  unreadCount: number;
}

export function NotificationsView({
  notifications,
  unreadCount,
}: NotificationsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleMarkOne = (id: string, href?: string | null) => {
    startTransition(async () => {
      const res = await markNotificationReadAction(id);
      if (res.success) {
        if (href) router.push(href);
      }
    });
  };

  const handleMarkAll = () => {
    startTransition(async () => {
      const res = await markAllNotificationsReadAction();
      if (res.success) {
        toast.success("All notifications marked as read.");
      }
    });
  };

  if (notifications.length === 0) {
    return (
      <Card className="border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Bell className="h-12 w-12 mb-3 opacity-30 text-primary" />
          <h3 className="font-semibold text-foreground text-base">No Notifications</h3>
          <p className="text-sm mt-1 max-w-sm">
            You are all caught up! You will be notified here when updates occur regarding your appointments and scheduling.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2">
        <span className="text-sm text-muted-foreground">
          {unreadCount > 0 ? `${unreadCount} unread notification(s)` : "All notifications read"}
        </span>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAll}
            disabled={isPending}
            className="text-xs gap-1.5"
          >
            <Check className="h-3.5 w-3.5 text-primary" />
            Mark all as read
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {notifications.map((item) => {
          const isUnread = !item.readAt;

          return (
            <Card
              key={item.id}
              className={`overflow-hidden border-border transition-all ${
                isUnread ? "border-primary/40 bg-primary/5 shadow-xs" : "opacity-80"
              }`}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-sm text-foreground">
                        {item.title}
                      </h4>
                      {isUnread && (
                        <Badge variant="default" className="text-[10px] uppercase">
                          New
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {item.body}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                      <Clock className="h-3 w-3 text-primary" />
                      <span>{formatDateTimeIST(item.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                    {item.href && (
                      <Link
                        href={item.href}
                        onClick={() => handleMarkOne(item.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {isUnread && (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={isPending}
                        onClick={() => handleMarkOne(item.id)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
