export interface MaintenanceGate {
  claim(now: Date, cutoff: Date, lockUntil: Date): Promise<boolean>;
  release(lockUntil: Date): Promise<void>;
}

const RATE_LIMIT_MS = 60 * 1000;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export async function claimMaintenanceRun(
  gate: MaintenanceGate,
  now = new Date()
): Promise<{ claimed: boolean; lockUntil: Date }> {
  const lockUntil = new Date(now.getTime() + LOCK_TIMEOUT_MS);
  const cutoff = new Date(now.getTime() - RATE_LIMIT_MS);
  return {
    claimed: await gate.claim(now, cutoff, lockUntil),
    lockUntil,
  };
}

export async function runMaintenanceSafely(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error("[Maintenance] Opportunistic run failed:", error);
  }
}
