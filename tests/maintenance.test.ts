import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { claimMaintenanceRun, runMaintenanceSafely, type MaintenanceGate } from "../src/lib/maintenance-utils";

class InMemoryMaintenanceGate implements MaintenanceGate {
  private lastStartedAt: Date | null = null;
  private lockUntil: Date | null = null;

  async claim(now: Date, cutoff: Date, lockUntil: Date): Promise<boolean> {
    if (
      (this.lastStartedAt && this.lastStartedAt > cutoff) ||
      (this.lockUntil && this.lockUntil >= now)
    ) {
      return false;
    }
    this.lastStartedAt = now;
    this.lockUntil = lockUntil;
    return true;
  }

  async release(lockUntil: Date): Promise<void> {
    if (this.lockUntil?.getTime() === lockUntil.getTime()) {
      this.lockUntil = null;
    }
  }
}

describe("opportunistic maintenance", () => {
  it("enforces the 60-second rate limit", async () => {
    const gate = new InMemoryMaintenanceGate();
    const first = await claimMaintenanceRun(gate, new Date("2026-10-31T02:00:00.000Z"));
    const tooSoon = await claimMaintenanceRun(gate, new Date("2026-10-31T02:00:30.000Z"));
    await gate.release(first.lockUntil);
    const later = await claimMaintenanceRun(gate, new Date("2026-10-31T02:01:01.000Z"));

    assert.equal(first.claimed, true);
    assert.equal(tooSoon.claimed, false);
    assert.equal(later.claimed, true);
  });

  it("allows only one concurrent caller to claim the run", async () => {
    const gate = new InMemoryMaintenanceGate();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        claimMaintenanceRun(gate, new Date("2026-10-31T02:00:00.000Z"))
      )
    );

    assert.equal(results.filter((result) => result.claimed).length, 1);
  });

  it("contains maintenance failures instead of rejecting the page request", async () => {
    await assert.doesNotReject(() =>
      runMaintenanceSafely(async () => {
        throw new Error("maintenance unavailable");
      })
    );
  });
});
