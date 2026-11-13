export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Simple in-memory sliding-window rate limiter keyed by user ID and endpoint bucket.
 */
export class SlidingWindowRateLimiter {
  private readonly store = new Map<string, number[]>();

  check(
    key: string,
    options: { limit: number; windowMs: number; now?: number }
  ): RateLimitResult {
    const now = options.now ?? Date.now();
    const cutoff = now - options.windowMs;
    const timestamps = this.store.get(key) ?? [];
    const active = timestamps.filter((ts) => ts > cutoff);

    if (active.length >= options.limit) {
      this.store.set(key, active);
      const oldestActive = active[0] ?? now;
      const retryAfterMs = Math.max(1000, oldestActive + options.windowMs - now);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    active.push(now);
    this.store.set(key, active);

    // Opportunistically prune stale keys so memory stays bounded.
    if (this.store.size > 1000) {
      for (const [entryKey, entryTimes] of this.store.entries()) {
        if (entryTimes.length === 0 || entryTimes[entryTimes.length - 1] <= cutoff) {
          this.store.delete(entryKey);
        }
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, options.limit - active.length),
      retryAfterSeconds: 0,
    };
  }
}

const globalForRateLimit = globalThis as unknown as {
  __medrellaAiRateLimiter?: SlidingWindowRateLimiter;
};

const sharedRateLimiter =
  globalForRateLimit.__medrellaAiRateLimiter ?? new SlidingWindowRateLimiter();
globalForRateLimit.__medrellaAiRateLimiter = sharedRateLimiter;

export function checkAiRateLimit(
  bucket: "chat" | "confirm" | "history",
  userId: string
): RateLimitResult {
  const limit = bucket === "chat" ? 25 : bucket === "confirm" ? 20 : 60;
  return sharedRateLimiter.check(`${bucket}:${userId}`, {
    limit,
    windowMs: 60_000,
  });
}

