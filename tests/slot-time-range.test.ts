import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatSlotRange,
  formatSlotDateTimeRangeIST,
  createISTDate,
} from "../src/lib/time";

describe("formatSlotRange Unit Tests", () => {
  it("formats normal morning slot correctly with lowercase am and hyphen", () => {
    // 09:00 AM IST to 09:30 AM IST (30 mins)
    const start = createISTDate(2026, 11, 2, 9, 0);
    const end = createISTDate(2026, 11, 2, 9, 30);

    const range = formatSlotRange(start, end);
    assert.equal(range, "09:00 am - 09:30 am");

    // Also accepts ISO strings
    assert.equal(formatSlotRange(start.toISOString(), end.toISOString()), "09:00 am - 09:30 am");
    // And numeric timestamps
    assert.equal(formatSlotRange(start.getTime(), end.getTime()), "09:00 am - 09:30 am");
  });

  it("formats slot crossing noon correctly (am to pm)", () => {
    // 11:45 AM IST to 12:15 PM IST (30 mins)
    const start = createISTDate(2026, 11, 2, 11, 45);
    const end = createISTDate(2026, 11, 2, 12, 15);

    const range = formatSlotRange(start, end);
    assert.equal(range, "11:45 am - 12:15 pm");
  });

  it("formats midnight edge slots correctly", () => {
    // 11:45 PM IST to 12:00 AM IST (crossing midnight into next day)
    const startLate = createISTDate(2026, 11, 2, 23, 45);
    const endMidnight = createISTDate(2026, 11, 3, 0, 0);

    assert.equal(formatSlotRange(startLate, endMidnight), "11:45 pm - 12:00 am");

    // 12:00 AM IST to 12:30 AM IST (starting at midnight)
    const startMidnight = createISTDate(2026, 11, 3, 0, 0);
    const endEarly = createISTDate(2026, 11, 3, 0, 30);

    assert.equal(formatSlotRange(startMidnight, endEarly), "12:00 am - 12:30 am");
  });

  it("handles 15, 30, 45, and 60 minute slot durations", () => {
    const base = createISTDate(2026, 11, 2, 14, 0); // 02:00 pm

    // 15 mins: 02:00 pm - 02:15 pm
    const end15 = createISTDate(2026, 11, 2, 14, 15);
    assert.equal(formatSlotRange(base, end15), "02:00 pm - 02:15 pm");

    // 30 mins: 02:00 pm - 02:30 pm
    const end30 = createISTDate(2026, 11, 2, 14, 30);
    assert.equal(formatSlotRange(base, end30), "02:00 pm - 02:30 pm");

    // 45 mins: 02:00 pm - 02:45 pm
    const end45 = createISTDate(2026, 11, 2, 14, 45);
    assert.equal(formatSlotRange(base, end45), "02:00 pm - 02:45 pm");

    // 60 mins: 02:00 pm - 03:00 pm
    const end60 = createISTDate(2026, 11, 2, 15, 0);
    assert.equal(formatSlotRange(base, end60), "02:00 pm - 03:00 pm");
  });

  it("formats date and slot range combined via formatSlotDateTimeRangeIST", () => {
    const start = createISTDate(2026, 11, 2, 9, 0);
    const end = createISTDate(2026, 11, 2, 9, 30);

    const formatted = formatSlotDateTimeRangeIST(start, end);
    assert.equal(formatted.includes("09:00 am - 09:30 am"), true);
    assert.equal(formatted.includes("2026"), true);
  });
});
