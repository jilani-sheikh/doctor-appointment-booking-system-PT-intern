"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface LiveQueueRefreshProps {
  intervalMs?: number;
}

/**
 * Lightweight client refresher mounted when a patient has an active today consultation,
 * keeping token callouts, queue positions, and estimated start times synchronized.
 */
export function LiveQueueRefresh({ intervalMs = 15000 }: LiveQueueRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return null;
}

