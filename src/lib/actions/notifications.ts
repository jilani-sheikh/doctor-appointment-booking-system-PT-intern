"use server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function markNotificationReadAction(notificationId: string) {
  const user = await requireUser();

  try {
    await db.notification.updateMany({
      where: {
        id: notificationId,
        userId: user.id,
      },
      data: {
        readAt: new Date(),
      },
    });

    revalidatePath("/notifications");
    return { success: true };
  } catch (error) {
    console.error("[markNotificationReadAction] Error:", error);
    return { success: false, error: "Failed to mark notification as read." };
  }
}

export async function markAllNotificationsReadAction() {
  const user = await requireUser();

  try {
    await db.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    revalidatePath("/notifications");
    return { success: true };
  } catch (error) {
    console.error("[markAllNotificationsReadAction] Error:", error);
    return { success: false, error: "Failed to mark all as read." };
  }
}
