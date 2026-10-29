"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/lib/actions/notifications";
import { formatDateTimeIST } from "@/lib/time";
import type { SerializedNotification } from "@/lib/serializers";

interface NotificationBellProps {
  unreadCount: number;
  recentNotifications: SerializedNotification[];
}

export function NotificationBell({
  unreadCount: initialCount,
  recentNotifications: initialItems,
}: NotificationBellProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialCount);
  const [notifications, setNotifications] = useState(initialItems);
  const [isPending, startTransition] = useTransition();

  const handleMarkOneRead = (id: string, href?: string | null) => {
    startTransition(async () => {
      await markNotificationReadAction(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      if (href) {
        setIsOpen(false);
        router.push(href);
      }
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative text-muted-foreground hover:text-foreground"
            aria-label={`Notifications (${unreadCount} unread)`}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground animate-pulse">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Button>
        }
      />
      <DialogContent className="max-w-md p-0 overflow-hidden bg-card border-border">
        <DialogHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
          <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <span>Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {unreadCount} unread
              </Badge>
            )}
          </DialogTitle>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={handleMarkAllRead}
              disabled={isPending}
              className="text-xs text-primary hover:text-primary/80"
            >
              Mark all read
            </Button>
          )}
        </DialogHeader>

        <div className="max-h-[360px] overflow-y-auto divide-y divide-border/60">
          {notifications.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-30 text-primary" />
              <p className="text-sm">You have no notifications right now.</p>
            </div>
          ) : (
            notifications.map((item) => {
              const isUnread = !item.readAt;
              return (
                <div
                  key={item.id}
                  className={`p-3.5 transition-colors cursor-pointer hover:bg-muted/40 ${
                    isUnread ? "bg-primary/5 font-medium" : "opacity-80"
                  }`}
                  onClick={() => handleMarkOneRead(item.id, item.href)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-semibold text-foreground line-clamp-1">
                      {item.title}
                    </h4>
                    {isUnread && (
                      <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {item.body}
                  </p>
                  <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateTimeIST(item.createdAt)}
                    </span>
                    {item.href && (
                      <span className="flex items-center gap-0.5 text-primary">
                        View <ExternalLink className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-2 border-t border-border bg-muted/20 text-center">
          <Link
            href="/notifications"
            onClick={() => setIsOpen(false)}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all notifications
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
