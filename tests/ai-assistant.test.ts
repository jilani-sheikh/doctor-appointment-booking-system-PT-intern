import test from "node:test";
import assert from "node:assert/strict";
import { APICallError, RetryError } from "ai";
import {
  AppointmentStatus,
  AvailabilityKind,
  RescheduleLifecycleStatus,
  SlotStatus,
} from "../src/generated/prisma/enums";
import {
  hashConfirmationPayload,
  signConfirmationToken,
  verifyConfirmationToken,
} from "../src/lib/ai/confirmation-token";
import {
  buildChatSessionTitle,
  buildDoctorStatsCard,
  computeDoctorAppointmentStats,
  detectDoctorSchedulingConflicts,
  extractGeminiStatusCode,
  getGeminiModelCandidates,
  getISTHHmm,
  isActionAllowedForRole,
  isFallbackEligibleGeminiError,
  resolveISTDateInput,
} from "../src/lib/ai/helpers";
import {
  cleanTextForSpeech,
  parseFormattedAssistantBlocks,
  parseInlineBoldSpans,
  splitSpeechChunks,
  stripMarkdownAsterisks,
} from "../src/lib/ai/format-text";
import { checkAiRateLimit, SlidingWindowRateLimiter } from "../src/lib/ai/rate-limit";
import {
  chatRequestSchema,
  confirmActionTypeSchema,
  confirmPayloadSchemas,
} from "../src/lib/ai/schemas";
import { DEFAULT_GEMINI_MODEL, getGeminiModelId } from "../src/lib/env";
import { parseISTDateTime } from "../src/lib/time";

const TEST_SECRET = "medrella-test-hmac-secret-at-least-32-chars-long";

test("AI confirmation token signs and verifies valid owner, role, and payload", () => {
  const now = 1_760_000_000_000;
  const { token, claims } = signConfirmationToken(
    {
      confirmationId: "conf_123",
      userId: "user_patient_1",
      role: "PATIENT",
      action: "PATIENT_BOOK_APPOINTMENT",
      payload: { availabilityId: "avail_1", notes: "Checkup" },
      issuedAt: now,
      expiresAt: now + 60_000,
    },
    TEST_SECRET
  );

  assert.equal(claims.confirmationId, "conf_123");

  const verified = verifyConfirmationToken({
    token,
    expectedUserId: "user_patient_1",
    expectedRole: "PATIENT",
    secret: TEST_SECRET,
    now: now + 10_000,
  });

  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.claims.action, "PATIENT_BOOK_APPOINTMENT");
    assert.equal(verified.claims.payload.availabilityId, "avail_1");
  }
});

test("Canonical payload hash ignores object key insertion order", () => {
  const h1 = hashConfirmationPayload("PATIENT_RESCHEDULE_APPOINTMENT", {
    appointmentId: "appt_1",
    newAvailabilityId: "avail_2",
    reason: "Changed timing",
  });
  const h2 = hashConfirmationPayload("PATIENT_RESCHEDULE_APPOINTMENT", {
    reason: "Changed timing",
    newAvailabilityId: "avail_2",
    appointmentId: "appt_1",
  });
  assert.equal(h1, h2);
});

test("AI confirmation token rejects tampered signature, tampered payload, expired, and cross-user/role attempts", () => {
  const now = 1_760_000_000_000;
  const { token } = signConfirmationToken(
    {
      confirmationId: "conf_sec",
      userId: "user_doc_1",
      role: "DOCTOR",
      action: "DOCTOR_SHRINK_AVAILABILITY",
      payload: {
        scheduleId: "sched_1",
        date: "2026-11-20",
        edge: "END",
        steps: 1,
        applyToFuture: false,
      },
      issuedAt: now,
      expiresAt: now + 60_000,
    },
    TEST_SECRET
  );

  // Tampered signature
  const [payloadB64, sigB64] = token.split(".");
  const tamperedSig = `${payloadB64}.${sigB64.slice(0, -2)}AA`;
  const sigRes = verifyConfirmationToken({
    token: tamperedSig,
    expectedUserId: "user_doc_1",
    expectedRole: "DOCTOR",
    secret: TEST_SECRET,
    now: now + 5_000,
  });
  assert.equal(sigRes.ok, false);
  if (!sigRes.ok) assert.equal(sigRes.code, "INVALID_SIGNATURE");

  // Wrong secret
  const wrongSecret = verifyConfirmationToken({
    token,
    expectedUserId: "user_doc_1",
    expectedRole: "DOCTOR",
    secret: "different-secret-that-must-fail-verification-check",
    now: now + 5_000,
  });
  assert.equal(wrongSecret.ok, false);

  // Expired
  const expiredRes = verifyConfirmationToken({
    token,
    expectedUserId: "user_doc_1",
    expectedRole: "DOCTOR",
    secret: TEST_SECRET,
    now: now + 60_001,
  });
  assert.equal(expiredRes.ok, false);
  if (!expiredRes.ok) assert.equal(expiredRes.code, "EXPIRED");

  // Cross-user attempt
  const crossUser = verifyConfirmationToken({
    token,
    expectedUserId: "user_doc_other",
    expectedRole: "DOCTOR",
    secret: TEST_SECRET,
    now: now + 5_000,
  });
  assert.equal(crossUser.ok, false);
  if (!crossUser.ok) assert.equal(crossUser.code, "FORBIDDEN");

  // Cross-role attempt
  const crossRole = verifyConfirmationToken({
    token,
    expectedUserId: "user_doc_1",
    expectedRole: "PATIENT",
    secret: TEST_SECRET,
    now: now + 5_000,
  });
  assert.equal(crossRole.ok, false);
  if (!crossRole.ok) assert.equal(crossRole.code, "FORBIDDEN");

  // Malformed format
  const malformed = verifyConfirmationToken({
    token: "not-a-valid-token",
    expectedUserId: "user_doc_1",
    expectedRole: "DOCTOR",
    secret: TEST_SECRET,
    now,
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, "INVALID_FORMAT");
});

test("Role isolation strictly separates PATIENT and DOCTOR confirmation actions", () => {
  for (const action of confirmActionTypeSchema.options) {
    if (action.startsWith("PATIENT_")) {
      assert.equal(isActionAllowedForRole(action, "PATIENT"), true);
      assert.equal(isActionAllowedForRole(action, "DOCTOR"), false);
    } else {
      assert.equal(isActionAllowedForRole(action, "DOCTOR"), true);
      assert.equal(isActionAllowedForRole(action, "PATIENT"), false);
    }
  }
});

test("Chat request and confirmation payload Zod schemas reject invalid inputs", () => {
  assert.equal(
    chatRequestSchema.safeParse({ messages: [], language: "en-IN" }).success,
    false
  );
  assert.equal(
    chatRequestSchema.safeParse({
      messages: [{ role: "user", content: "   " }],
      language: "hi-IN",
    }).success,
    false
  );
  assert.equal(
    chatRequestSchema.safeParse({
      messages: [{ role: "user", content: "Kal mera appointment kab hai?" }],
      language: "hinglish",
    }).success,
    true
  );

  assert.equal(
    confirmPayloadSchemas.DOCTOR_SHRINK_AVAILABILITY.safeParse({
      scheduleId: "s1",
      date: "2026-11-20",
      edge: "END",
      steps: 0,
      applyToFuture: false,
    }).success,
    false
  );
  assert.equal(
    confirmPayloadSchemas.DOCTOR_SHRINK_AVAILABILITY.safeParse({
      scheduleId: "s1",
      date: "2026-11-20",
      edge: "END",
      steps: 2,
      applyToFuture: true,
    }).success,
    true
  );
});

test("Doctor stats computation counts statuses and disrupted pending reschedules accurately", () => {
  const stats = computeDoctorAppointmentStats([
    { status: AppointmentStatus.CONFIRMED, disruptedAt: null, rescheduleStatus: null },
    {
      status: AppointmentStatus.CONFIRMED,
      disruptedAt: new Date("2026-11-15T10:00:00Z"),
      rescheduleStatus: RescheduleLifecycleStatus.PENDING_RESCHEDULING,
    },
    { status: AppointmentStatus.CHECKED_IN, disruptedAt: null, rescheduleStatus: null },
    { status: AppointmentStatus.IN_CONSULTATION, disruptedAt: null, rescheduleStatus: null },
    { status: AppointmentStatus.COMPLETED, disruptedAt: null, rescheduleStatus: null },
    { status: AppointmentStatus.COMPLETED, disruptedAt: null, rescheduleStatus: null },
    { status: AppointmentStatus.CANCELLED, disruptedAt: null, rescheduleStatus: null },
    { status: AppointmentStatus.NO_SHOW, disruptedAt: null, rescheduleStatus: null },
    { status: AppointmentStatus.PENDING_PAYMENT, disruptedAt: null, rescheduleStatus: null },
  ]);

  assert.equal(stats.total, 9);
  assert.equal(stats.confirmed, 2);
  assert.equal(stats.checkedIn, 1);
  assert.equal(stats.inConsultation, 1);
  assert.equal(stats.completed, 2);
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.noShow, 1);
  assert.equal(stats.pendingPayment, 1);
  assert.equal(stats.disruptedPendingReschedule, 1);

  const card = buildDoctorStatsCard("Today Stats", "15 Nov 2026", stats);
  assert.equal(card.type, "stats_summary");
  assert.equal(card.metrics.length, 8);
});

test("Conflict detection flags time-off, blocked-slot, cross-slot overlap, and allows shared wave seats", () => {
  const waveStart = parseISTDateTime("2026-11-20", "10:00");
  const waveEnd = parseISTDateTime("2026-11-20", "10:30");

  const sharedWaveSlot = {
    id: "wave_slot_1",
    startTime: waveStart,
    endTime: waveEnd,
    status: SlotStatus.AVAILABLE,
    kind: AvailabilityKind.WAVE_SLOT,
    capacity: 4,
    activeCount: 2,
  };

  // Two patients in same WAVE_SLOT within capacity -> ZERO conflicts!
  const cleanWave = detectDoctorSchedulingConflicts({
    appointments: [
      {
        id: "a1",
        patientName: "Asha",
        status: AppointmentStatus.CONFIRMED,
        slotStart: null,
        slotEnd: null,
        disruptedAt: null,
        rescheduleStatus: null,
        availability: sharedWaveSlot,
      },
      {
        id: "a2",
        patientName: "Vikram",
        status: AppointmentStatus.CONFIRMED,
        slotStart: null,
        slotEnd: null,
        disruptedAt: null,
        rescheduleStatus: null,
        availability: sharedWaveSlot,
      },
    ],
    timeOffs: [],
  });
  assert.equal(cleanWave.length, 0);

  // Add cross-slot overlap + leave collision + disrupted booking
  const overlappingOtherSlot = {
    id: "single_slot_9",
    startTime: parseISTDateTime("2026-11-20", "10:15"),
    endTime: parseISTDateTime("2026-11-20", "10:45"),
    status: SlotStatus.BLOCKED,
    kind: AvailabilityKind.SINGLE,
    capacity: 1,
    activeCount: 1,
  };

  const conflicts = detectDoctorSchedulingConflicts({
    appointments: [
      {
        id: "a1",
        patientName: "Asha",
        status: AppointmentStatus.CONFIRMED,
        slotStart: null,
        slotEnd: null,
        disruptedAt: null,
        rescheduleStatus: null,
        availability: sharedWaveSlot,
      },
      {
        id: "a3",
        patientName: "Rohan",
        status: AppointmentStatus.CONFIRMED,
        slotStart: null,
        slotEnd: null,
        disruptedAt: null,
        rescheduleStatus: null,
        availability: overlappingOtherSlot,
      },
    ],
    timeOffs: [
      {
        id: "to1",
        startAt: parseISTDateTime("2026-11-20", "10:20"),
        endAt: parseISTDateTime("2026-11-20", "12:00"),
        reason: "Hospital round",
      },
    ],
  });

  const kinds = new Set(conflicts.map((c) => c.kind));
  assert.equal(kinds.has("BOOKED_ON_BLOCKED_SLOT"), true);
  assert.equal(kinds.has("TIME_OFF_COLLISION"), true);
  assert.equal(kinds.has("OVERLAPPING_APPOINTMENTS"), true);
});

test("Rate limiter enforces sliding window and resets cleanly once window expires", () => {
  const limiter = new SlidingWindowRateLimiter();
  const baseTime = 1_760_000_000_000;

  const r1 = limiter.check("chat:u1", { limit: 2, windowMs: 10_000, now: baseTime });
  const r2 = limiter.check("chat:u1", { limit: 2, windowMs: 10_000, now: baseTime + 1_000 });
  const r3 = limiter.check("chat:u1", { limit: 2, windowMs: 10_000, now: baseTime + 2_000 });
  const otherUser = limiter.check("chat:u2", { limit: 2, windowMs: 10_000, now: baseTime + 2_000 });

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, false);
  assert.ok(r3.retryAfterSeconds >= 1);
  assert.equal(otherUser.allowed, true);

  const afterReset = limiter.check("chat:u1", {
    limit: 2,
    windowMs: 10_000,
    now: baseTime + 10_001,
  });
  assert.equal(afterReset.allowed, true);
});

test("resolveISTDateInput handles relative dates and invalid values safely", () => {
  assert.match(resolveISTDateInput("today") ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(resolveISTDateInput("tomorrow") ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(resolveISTDateInput("2026-12-01"), "2026-12-01");
  assert.equal(resolveISTDateInput("invalid-date"), null);
});

test("Gemini model selection defaults to active gemini-3.8-flash with deduplicated fallbacks", () => {
  const prev = process.env.GEMINI_MODEL;
  try {
    delete process.env.GEMINI_MODEL;
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.8-flash");
    assert.equal(getGeminiModelId(), "gemini-3.8-flash");

    const defaultCandidates = getGeminiModelCandidates();
    assert.equal(defaultCandidates[0], "gemini-3.8-flash");
    assert.equal(defaultCandidates.includes("gemini-2.5-flash"), false);
    assert.equal(defaultCandidates.includes("gemini-3-flash-preview"), true);
    assert.equal(defaultCandidates.includes("gemini-flash-lite-latest"), true);

    process.env.GEMINI_MODEL = "gemini-3-flash-preview";
    assert.equal(getGeminiModelId(), "gemini-3-flash-preview");
    const customCandidates = getGeminiModelCandidates();
    assert.equal(customCandidates[0], "gemini-3-flash-preview");
    assert.equal(
      customCandidates.filter((id) => id === "gemini-3-flash-preview").length,
      1
    );
  } finally {
    if (prev === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = prev;
    }
  }
});

test("Gemini fallback classifier retries unavailable/timeout errors but fails fast on auth errors", () => {
  const notFoundErr = new APICallError({
    message: "Model not found",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    requestBodyValues: {},
    statusCode: 404,
  });
  const unavailableErr = new APICallError({
    message: "High demand",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    requestBodyValues: {},
    statusCode: 503,
  });
  const unauthorizedErr = new APICallError({
    message: "API key invalid",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    requestBodyValues: {},
    statusCode: 401,
  });
  const retryWrapped429 = new RetryError({
    message: "Rate limited",
    reason: "maxRetriesExceeded",
    errors: [
      new APICallError({
        message: "Too many requests",
        url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        requestBodyValues: {},
        statusCode: 429,
      }),
    ],
  });

  const timeoutErr = new Error("The operation was aborted due to timeout");
  timeoutErr.name = "TimeoutError";

  assert.equal(extractGeminiStatusCode(notFoundErr), 404);
  assert.equal(extractGeminiStatusCode(retryWrapped429), 429);
  assert.equal(isFallbackEligibleGeminiError(notFoundErr), true);
  assert.equal(isFallbackEligibleGeminiError(unavailableErr), true);
  assert.equal(isFallbackEligibleGeminiError(retryWrapped429), true);
  assert.equal(isFallbackEligibleGeminiError(timeoutErr), true);
  assert.equal(isFallbackEligibleGeminiError(unauthorizedErr), false);
});

test("parseFormattedAssistantBlocks and stripMarkdownAsterisks eliminate raw asterisks while preserving structure", () => {
  const raw = [
    "### Appointment Summary:",
    "**Date:** 20 Nov 2026",
    "* **Dr. Asha** at 10:00 AM",
    "- Consultation fee: ₹500 *confirmed*",
    "1. Click **Confirm** below to save *your* change",
    "***",
    "Need anything else? **Just ask!**",
  ].join("\n");

  const blocks = parseFormattedAssistantBlocks(raw);
  assert.equal(blocks.length, 6);
  assert.equal(blocks[0]?.kind, "heading");
  assert.equal(blocks[1]?.kind, "paragraph");
  if (blocks[1]?.kind === "paragraph") {
    assert.deepEqual(blocks[1].spans[0], { text: "Date:", bold: true });
    assert.deepEqual(blocks[1].spans[1], { text: " 20 Nov 2026", bold: false });
  }
  assert.equal(blocks[2]?.kind, "bullet");
  assert.equal(blocks[3]?.kind, "bullet");
  assert.equal(blocks[4]?.kind, "numbered");
  if (blocks[4]?.kind === "numbered") {
    assert.equal(blocks[4].numberLabel, "1.");
  }
  assert.equal(blocks[5]?.kind, "paragraph");

  const stripped = stripMarkdownAsterisks(raw);
  assert.equal(stripped.includes("*"), false);
  assert.equal(stripped.includes("#"), false);
  assert.equal(stripped.includes("Dr. Asha at 10:00 AM"), true);

  const spans = parseInlineBoldSpans("Hello **Dr. Mehta** at *4:00 PM*!");
  assert.deepEqual(spans, [
    { text: "Hello ", bold: false },
    { text: "Dr. Mehta", bold: true },
    { text: " at 4:00 PM!", bold: false },
  ]);
});

test("cleanTextForSpeech and splitSpeechChunks produce natural, smooth spoken phrases", () => {
  const raw = [
    "**Today's Schedule:**",
    "* **Dr. Priya Sharma** from 02:00 PM - 02:30 PM, fee ₹750.",
    "1. Please arrive 15 minutes early.",
    "2. Carry your previous blood test reports and ask at reception if you need wheelchair assistance or water.",
  ].join("\n");

  const cleaned = cleanTextForSpeech(raw);
  assert.equal(cleaned.includes("*"), false);
  assert.equal(cleaned.includes("₹"), false);
  assert.equal(cleaned.includes("750 rupees"), true);
  assert.equal(cleaned.includes("02:00 PM to 02:30 PM"), true);

  const chunks = splitSpeechChunks(cleaned, 120);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.some((c) => c === "Dr."), false);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 120);
  }
});

test("getISTHHmm preserves 24-hour AM/PM time accurately for parseISTDateTime roundtrips", () => {
  const morningIST = parseISTDateTime("2026-11-20", "09:15");
  const afternoonIST = parseISTDateTime("2026-11-20", "14:45");
  const midnightIST = parseISTDateTime("2026-11-20", "00:05");

  assert.equal(getISTHHmm(morningIST), "09:15");
  assert.equal(getISTHHmm(afternoonIST), "14:45");
  assert.equal(getISTHHmm(midnightIST), "00:05");

  const roundtrip = parseISTDateTime("2026-11-20", getISTHHmm(afternoonIST));
  assert.equal(roundtrip.getTime(), afternoonIST.getTime());
});

test("Elastic schedule confirm schemas allow extended step counts matching elastic UI", () => {
  assert.equal(
    confirmPayloadSchemas.DOCTOR_SHRINK_AVAILABILITY.safeParse({
      scheduleId: "sched_1",
      date: "2026-11-20",
      edge: "END",
      steps: 12,
      applyToFuture: false,
    }).success,
    true
  );
  assert.equal(
    confirmPayloadSchemas.DOCTOR_EXPAND_AVAILABILITY.safeParse({
      scheduleId: "sched_1",
      date: "2026-11-20",
      edge: "START",
      steps: 100,
      applyToFuture: true,
    }).success,
    true
  );
  assert.equal(
    confirmPayloadSchemas.DOCTOR_EXPAND_AVAILABILITY.safeParse({
      scheduleId: "sched_1",
      date: "2026-11-20",
      edge: "START",
      steps: 101,
      applyToFuture: false,
    }).success,
    false
  );
});

test("Chat history helpers sanitize titles, validate optional sessionId, and rate limit history bucket", () => {
  assert.equal(buildChatSessionTitle("   "), "New conversation");
  assert.equal(
    buildChatSessionTitle("Show   my   appointments\nfor tomorrow"),
    "Show my appointments for tomorrow"
  );
  const longTitle = buildChatSessionTitle("a".repeat(90));
  assert.equal(longTitle.length, 72);
  assert.equal(longTitle.endsWith("..."), true);

  assert.equal(
    chatRequestSchema.safeParse({
      sessionId: "cm_test_session_123",
      messages: [{ role: "user", content: "Hello" }],
      language: "en-IN",
    }).success,
    true
  );

  const historyRate = checkAiRateLimit("history", "unit_test_history_user");
  assert.equal(historyRate.allowed, true);
});
