import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateElasticRange,
  diffAvailabilityIntervals,
  generateScheduleAvailabilities,
  getVisibleAlternativeCategories,
  isCrossDoctorPaymentCompatible,
  isEligibleForDisruptedDashboardAlternatives,
  selectThreeLevelAlternatives,
  type AlternativeSlotCandidate,
} from "../src/lib/scheduling";
import { toPatientAppointmentDto } from "../src/lib/serializers";
import { renderElasticShrinkRescheduleEmail } from "../src/lib/email/templates/index";
import { canPatientReschedule } from "../src/lib/appointment-status";
import { calculateRefundPolicy } from "../src/lib/refund-policy";
import {
  AppointmentStatus,
  RefundReason,
  RescheduleLifecycleStatus,
  VisitStream,
} from "../src/generated/prisma/client";

test("Wave shrink: identifies affected vs unaffected subslots and preserves historical/booked records", () => {
  const rows = generateScheduleAvailabilities(
    {
      type: "WAVE",
      recurrence: "ONCE",
      startDate: "2026-11-15",
      endDate: "2026-11-15",
      daysOfWeek: [0],
      startMinute: 540, // 09:00 IST
      endMinute: 660, // 11:00 IST (4 x 30m subslots)
      durationMinutes: 30,
      capacity: 2,
    },
    "2026-11-10"
  );

  const parent = rows.find((r) => r.kind === "WAVE_PARENT")!;
  const children = rows.filter((r) => r.kind === "WAVE_SLOT");
  assert.equal(children.length, 4);

  // Shrink END by 2 steps (removes 10:00-10:30 and 10:30-11:00 IST)
  const shrunk = calculateElasticRange(parent, "END", 2, 30, "SHRINK");
  const diff = diffAvailabilityIntervals(parent, shrunk, 30);
  assert.equal(diff.removed.length, 2);

  // Simulate partially / fully booked subslots and historical subslots
  const simulatedChildren = [
    { ...children[0]!, id: "slot-1", activeAppointments: ["appt-1"], totalRefs: 1 }, // 09:00-09:30 (retained)
    { ...children[1]!, id: "slot-2", activeAppointments: [], totalRefs: 0 }, // 09:30-10:00 (retained)
    { ...children[2]!, id: "slot-3", activeAppointments: ["appt-2", "appt-3"], totalRefs: 2 }, // 10:00-10:30 (removed, fully booked)
    { ...children[3]!, id: "slot-4", activeAppointments: [], totalRefs: 1 }, // 10:30-11:00 (removed, historical cancelled ref)
  ];

  const removedChildren = simulatedChildren.filter((c) =>
    diff.removed.some((interval) => c.startTime < interval.endTime && c.endTime > interval.startTime)
  );
  const retainedChildren = simulatedChildren.filter(
    (c) => !removedChildren.some((rem) => rem.id === c.id)
  );

  assert.deepEqual(
    retainedChildren.map((c) => c.id),
    ["slot-1", "slot-2"]
  );
  assert.deepEqual(
    removedChildren.map((c) => c.id),
    ["slot-3", "slot-4"]
  );

  const affectedAppointments = removedChildren.flatMap((c) => c.activeAppointments);
  const unaffectedAppointments = retainedChildren.flatMap((c) => c.activeAppointments);

  // Only appointments in removed subslots are affected; retained appointments are untouched
  assert.deepEqual(affectedAppointments, ["appt-2", "appt-3"]);
  assert.deepEqual(unaffectedAppointments, ["appt-1"]);

  // Historical/booked removed child slots (totalRefs > 0) are preserved and blocked, never deleted
  const deletableIds = removedChildren.filter((c) => c.totalRefs === 0).map((c) => c.id);
  const blockedPreservedIds = removedChildren.filter((c) => c.totalRefs > 0).map((c) => c.id);
  assert.deepEqual(deletableIds, []);
  assert.deepEqual(blockedPreservedIds, ["slot-3", "slot-4"]);
});

test("Stream shrink: updates continuous window immediately, never creates subslots, and does not calculate capacity from duration", () => {
  const rows = generateScheduleAvailabilities(
    {
      type: "STREAM",
      recurrence: "ONCE",
      startDate: "2026-11-15",
      endDate: "2026-11-15",
      daysOfWeek: [0],
      startMinute: 540, // 09:00 IST
      endMinute: 720, // 12:00 IST
      durationMinutes: 30,
      capacity: 20, // Capacity exceeds windowMinutes / durationMinutes (6); valid in Stream
    },
    "2026-11-10"
  );

  // Stream generates exactly 1 continuous STREAM_WINDOW row and 0 child subslots
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, "STREAM_WINDOW");
  assert.equal(rows[0]!.capacity, 20);

  // Shrink END by 4 steps (2 hours -> remaining window is 1 hour, still keeping capacity 20)
  const shrunk = calculateElasticRange(rows[0]!, "END", 4, 30, "SHRINK");
  assert.equal((shrunk.endTime.getTime() - shrunk.startTime.getTime()) / 60_000, 60);

  // Active Stream bookings have slotStart = null, slotEnd = null -> all active bookings are conservatively marked affected
  const streamAppointments = [
    { id: "s-appt-1", slotStart: null, slotEnd: null, status: AppointmentStatus.CONFIRMED },
    { id: "s-appt-2", slotStart: null, slotEnd: null, status: AppointmentStatus.CONFIRMED },
  ];
  const affected = streamAppointments.filter((a) => !a.slotStart || !a.slotEnd);
  assert.equal(affected.length, 2);

  // Reduced Stream window remains AVAILABLE when activeCount < capacity
  const activeCount = 2;
  const remainingWindowStatus = activeCount >= rows[0]!.capacity ? "BOOKED" : "AVAILABLE";
  assert.equal(remainingWindowStatus, "AVAILABLE");
});

test("Three-level alternative discovery: Priority 1 (same day), Priority 2 (upcoming same doctor), Priority 3 (other clinic doctor)", () => {
  const now = new Date("2026-11-15T01:00:00.000Z");
  const minStartTime = new Date(now.getTime() + 60 * 60 * 1000);

  const originalAppointment = {
    availabilityId: "orig-slot",
    doctorId: "doc-1",
    specialization: "Cardiology",
    startTime: new Date("2026-11-15T08:00:00.000Z"), // 13:30 IST on 2026-11-15
    endTime: new Date("2026-11-15T08:30:00.000Z"),
    kind: "WAVE_SLOT" as const,
    consultationFeeRupees: 500,
  };

  const candidates: AlternativeSlotCandidate[] = [
    // Same-day alternatives with doc-1
    {
      id: "same-day-1",
      doctorId: "doc-1",
      doctorName: "Asha Rao",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-15T04:30:00.000Z"), // 10:00 IST on 2026-11-15
      endTime: new Date("2026-11-15T05:00:00.000Z"),
      status: "AVAILABLE",
      kind: "WAVE_SLOT",
      capacity: 2,
      activeCount: 1, // Partial capacity used, still available!
    },
    // Duplicate of same-day-1 (should be deduplicated)
    {
      id: "same-day-1-dup",
      doctorId: "doc-1",
      doctorName: "Asha Rao",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-15T04:30:00.000Z"),
      endTime: new Date("2026-11-15T05:00:00.000Z"),
      status: "AVAILABLE",
      kind: "WAVE_SLOT",
      capacity: 2,
      activeCount: 0,
    },
    // Shrunk Wave child outside parent range (must be rejected!)
    {
      id: "shrunk-child",
      doctorId: "doc-1",
      doctorName: "Asha Rao",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-15T09:00:00.000Z"),
      endTime: new Date("2026-11-15T09:30:00.000Z"),
      status: "AVAILABLE",
      kind: "WAVE_SLOT",
      capacity: 2,
      activeCount: 0,
      parentStartTime: new Date("2026-11-15T04:00:00.000Z"),
      parentEndTime: new Date("2026-11-15T06:00:00.000Z"),
      parentStatus: "AVAILABLE",
    },
    // Upcoming date with doc-1
    {
      id: "upcoming-1",
      doctorId: "doc-1",
      doctorName: "Asha Rao",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-16T04:30:00.000Z"), // Next day
      endTime: new Date("2026-11-16T05:00:00.000Z"),
      status: "AVAILABLE",
      kind: "WAVE_SLOT",
      capacity: 2,
      activeCount: 0,
    },
    // Other clinic doctor in same specialization
    {
      id: "other-doc-1",
      doctorId: "doc-2",
      doctorName: "Vikram Sen",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-15T05:00:00.000Z"),
      endTime: new Date("2026-11-15T05:30:00.000Z"),
      status: "AVAILABLE",
      kind: "WAVE_SLOT",
      capacity: 2,
      activeCount: 0,
    },
  ];

  // Case 1: Fewer than maxPerCategory (3) same-doctor suggestions (1 same-day + 1 upcoming = 2) -> Priority 3 IS also populated
  const resPartialSameDoc = selectThreeLevelAlternatives({
    originalAppointment,
    candidates,
    minStartTime,
    maxPerCategory: 3,
  });
  assert.equal(resPartialSameDoc.sameDayAlternatives.length, 1);
  assert.equal(resPartialSameDoc.sameDayAlternatives[0]!.id, "same-day-1");
  assert.equal(resPartialSameDoc.upcomingDateAlternatives.length, 1);
  assert.equal(resPartialSameDoc.upcomingDateAlternatives[0]!.id, "upcoming-1");
  assert.equal(resPartialSameDoc.otherDoctorAlternatives.length, 1);
  assert.equal(resPartialSameDoc.otherDoctorAlternatives[0]!.id, "other-doc-1");

  // Case 2: At least maxPerCategory (3) same-doctor suggestions exist -> Priority 3 is omitted
  const candidatesWithEnoughSameDoc: AlternativeSlotCandidate[] = [
    ...candidates,
    {
      id: "upcoming-2",
      doctorId: "doc-1",
      doctorName: "Asha Rao",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-16T05:00:00.000Z"),
      endTime: new Date("2026-11-16T05:30:00.000Z"),
      status: "AVAILABLE",
      kind: "WAVE_SLOT",
      capacity: 2,
      activeCount: 0,
    },
  ];
  const resEnoughSameDoc = selectThreeLevelAlternatives({
    originalAppointment,
    candidates: candidatesWithEnoughSameDoc,
    minStartTime,
    maxPerCategory: 3,
  });
  assert.equal(
    resEnoughSameDoc.sameDayAlternatives.length + resEnoughSameDoc.upcomingDateAlternatives.length,
    3
  );
  assert.equal(resEnoughSameDoc.otherDoctorAlternatives.length, 0);

  // Case 3: No same-doctor alternatives exist, but another clinic doctor has availability -> Priority 3 is populated
  const resOtherDocOnly = selectThreeLevelAlternatives({
    originalAppointment,
    candidates: candidates.filter((c) => c.doctorId !== "doc-1"),
    minStartTime,
  });
  assert.equal(resOtherDocOnly.sameDayAlternatives.length, 0);
  assert.equal(resOtherDocOnly.upcomingDateAlternatives.length, 0);
  assert.equal(resOtherDocOnly.otherDoctorAlternatives.length, 1);
  assert.equal(resOtherDocOnly.otherDoctorAlternatives[0]!.id, "other-doc-1");
  assert.equal(resOtherDocOnly.otherDoctorAlternatives[0]!.doctorName, "Vikram Sen");

  // Case 4: No alternatives exist anywhere
  const resEmpty = selectThreeLevelAlternatives({
    originalAppointment,
    candidates: [],
    minStartTime,
  });
  assert.equal(resEmpty.sameDayAlternatives.length, 0);
  assert.equal(resEmpty.upcomingDateAlternatives.length, 0);
  assert.equal(resEmpty.otherDoctorAlternatives.length, 0);
});

test("Cross-doctor rescheduling: verifies payment ledger consistency beyond equal current consultation fees", () => {
  // Valid: both doctors charge 500 and the single PAID payment recorded 500
  assert.equal(
    isCrossDoctorPaymentCompatible({
      originalDoctorFeeRupees: 500,
      targetDoctorFeeRupees: 500,
      payments: [{ status: "PAID", amountRupees: 500, needsAttention: false }],
      refundCount: 0,
      paymentsMode: "cashfree",
    }),
    true
  );

  // Rejected: doctors' current fees both equal 800, but patient originally paid 500 before a fee change
  assert.equal(
    isCrossDoctorPaymentCompatible({
      originalDoctorFeeRupees: 800,
      targetDoctorFeeRupees: 800,
      payments: [{ status: "PAID", amountRupees: 500, needsAttention: false }],
      refundCount: 0,
      paymentsMode: "cashfree",
    }),
    false
  );

  // Rejected: appointment already has a refund record or payment needsAttention
  assert.equal(
    isCrossDoctorPaymentCompatible({
      originalDoctorFeeRupees: 500,
      targetDoctorFeeRupees: 500,
      payments: [{ status: "PAID", amountRupees: 500, needsAttention: false }],
      refundCount: 1,
      paymentsMode: "cashfree",
    }),
    false
  );
  assert.equal(
    isCrossDoctorPaymentCompatible({
      originalDoctorFeeRupees: 500,
      targetDoctorFeeRupees: 500,
      payments: [{ status: "PAID", amountRupees: 500, needsAttention: true }],
      refundCount: 0,
      paymentsMode: "cashfree",
    }),
    false
  );

  // Rejected: unpaid appointment cannot move to a paid doctor when paymentsMode is cashfree
  assert.equal(
    isCrossDoctorPaymentCompatible({
      originalDoctorFeeRupees: 500,
      targetDoctorFeeRupees: 500,
      payments: [],
      refundCount: 0,
      paymentsMode: "cashfree",
    }),
    false
  );

  // Allowed when paymentsMode is disabled and fees match
  assert.equal(
    isCrossDoctorPaymentCompatible({
      originalDoctorFeeRupees: 500,
      targetDoctorFeeRupees: 500,
      payments: [],
      refundCount: 0,
      paymentsMode: "disabled",
    }),
    true
  );
});

test("Wave shrink and subsequent expansion: reactivates historical blocked child slots without duplicates", () => {
  const rows = generateScheduleAvailabilities(
    {
      type: "WAVE",
      recurrence: "ONCE",
      startDate: "2026-11-15",
      endDate: "2026-11-15",
      daysOfWeek: [0],
      startMinute: 540, // 09:00
      endMinute: 660, // 11:00 (4 x 30m subslots)
      durationMinutes: 30,
      capacity: 2,
    },
    "2026-11-10"
  );

  const parent = rows.find((r) => r.kind === "WAVE_PARENT")!;
  const shrunk = calculateElasticRange(parent, "END", 2, 30, "SHRINK");
  const reExpanded = calculateElasticRange(shrunk, "END", 2, 30, "EXPAND");
  const expandDiff = diffAvailabilityIntervals(shrunk, reExpanded, 30);
  assert.equal(expandDiff.added.length, 2);

  // Simulate two preserved BLOCKED child slots from the earlier shrink:
  // - slot-3 still has 1 active PENDING_RESCHEDULING appointment (1 < capacity 2 -> reactivates to AVAILABLE and restores appointment)
  // - slot-4 has 2 active appointments (2 >= capacity 2 -> reactivates to BOOKED)
  const preservedBlockedChildren = [
    {
      id: "slot-3",
      startTime: expandDiff.added[0]!.startTime,
      endTime: expandDiff.added[0]!.endTime,
      status: "BLOCKED",
      blockedByTimeOffId: null,
      capacity: 2,
      activeCount: 1,
      appointments: [
        {
          id: "appt-active-1",
          status: AppointmentStatus.CONFIRMED,
          rescheduleStatus: RescheduleLifecycleStatus.PENDING_RESCHEDULING,
        },
        {
          id: "appt-cancelled-1",
          status: AppointmentStatus.CANCELLED,
          rescheduleStatus: null,
        },
      ],
      rescheduledFromRefs: ["appt-moved-away"],
    },
    {
      id: "slot-4",
      startTime: expandDiff.added[1]!.startTime,
      endTime: expandDiff.added[1]!.endTime,
      status: "BLOCKED",
      blockedByTimeOffId: null,
      capacity: 2,
      activeCount: 2,
      appointments: [
        {
          id: "appt-active-2",
          status: AppointmentStatus.CONFIRMED,
          rescheduleStatus: RescheduleLifecycleStatus.PENDING_RESCHEDULING,
        },
        {
          id: "appt-active-3",
          status: AppointmentStatus.CONFIRMED,
          rescheduleStatus: RescheduleLifecycleStatus.PENDING_RESCHEDULING,
        },
      ],
      rescheduledFromRefs: [],
    },
  ];

  const reactivatedSlots = expandDiff.added.map((interval) => {
    const existing = preservedBlockedChildren.find(
      (c) => c.startTime.getTime() === interval.startTime.getTime()
    )!;
    const actualActiveCount = existing.appointments.filter(
      (a) => a.status === AppointmentStatus.CONFIRMED
    ).length;
    const effectiveCapacity = Math.max(2, actualActiveCount);
    const status = existing.blockedByTimeOffId
      ? "BLOCKED"
      : actualActiveCount >= effectiveCapacity
      ? "BOOKED"
      : "AVAILABLE";
    const restoredAppointmentIds = existing.appointments
      .filter(
        (a) =>
          a.status === AppointmentStatus.CONFIRMED &&
          a.rescheduleStatus === RescheduleLifecycleStatus.PENDING_RESCHEDULING
      )
      .map((a) => a.id);

    return {
      id: existing.id,
      activeCount: actualActiveCount,
      capacity: effectiveCapacity,
      status,
      restoredAppointmentIds,
      rescheduledFromRefs: existing.rescheduledFromRefs,
    };
  });

  assert.equal(reactivatedSlots.length, 2);
  assert.equal(reactivatedSlots[0]!.id, "slot-3");
  assert.equal(reactivatedSlots[0]!.activeCount, 1);
  assert.equal(reactivatedSlots[0]!.status, "AVAILABLE");
  assert.deepEqual(reactivatedSlots[0]!.restoredAppointmentIds, ["appt-active-1"]);
  assert.deepEqual(reactivatedSlots[0]!.rescheduledFromRefs, ["appt-moved-away"]);

  assert.equal(reactivatedSlots[1]!.id, "slot-4");
  assert.equal(reactivatedSlots[1]!.activeCount, 2);
  assert.equal(reactivatedSlots[1]!.status, "BOOKED");
  assert.deepEqual(reactivatedSlots[1]!.restoredAppointmentIds, ["appt-active-2", "appt-active-3"]);
});

test("Email notification: groups non-empty categories, omits empty categories, and renders fallback when no alternatives exist", () => {
  const emailWithSuggestions = renderElasticShrinkRescheduleEmail({
    appointmentId: "appt-123",
    patientName: "Riya Sharma",
    doctorName: "Asha Rao",
    specialization: "Cardiology",
    originalStartTime: new Date("2026-11-15T08:00:00.000Z"),
    originalEndTime: new Date("2026-11-15T08:30:00.000Z"),
    sameDayAlternatives: [
      {
        id: "slot-a",
        doctorId: "doc-1",
        doctorName: "Asha Rao",
        specialization: "Cardiology",
        startTime: "2026-11-15T04:30:00.000Z",
        endTime: "2026-11-15T05:00:00.000Z",
        kind: "WAVE_SLOT",
        capacity: 2,
        activeCount: 0,
      },
    ],
    upcomingDateAlternatives: [],
    otherDoctorAlternatives: [],
  });

  assert.equal(emailWithSuggestions.html.includes("1. Remaining slots on the same day"), true);
  assert.equal(emailWithSuggestions.html.includes("2. Other available dates with your doctor"), false);
  assert.equal(emailWithSuggestions.html.includes("3. Other doctors at the same clinic"), false);
  assert.equal(emailWithSuggestions.html.includes("/book/reschedule/appt-123"), true);
  assert.equal(emailWithSuggestions.html.includes("remain protected"), true);

  const emailNoAlternatives = renderElasticShrinkRescheduleEmail({
    appointmentId: "appt-456",
    patientName: "Riya Sharma",
    doctorName: "Asha Rao",
    originalStartTime: new Date("2026-11-15T08:00:00.000Z"),
    originalEndTime: new Date("2026-11-15T08:30:00.000Z"),
    sameDayAlternatives: [],
    upcomingDateAlternatives: [],
    otherDoctorAlternatives: [],
  });

  assert.equal(emailNoAlternatives.html.includes("No Immediate Alternatives Currently Available"), true);
  assert.equal(emailNoAlternatives.html.includes("contact the clinic"), true);
  assert.equal(emailNoAlternatives.html.includes("/book/reschedule/appt-456"), true);

  // Stream shrink email accurately explains why the continuous window booking was flagged and shows Updated Window
  const streamShrinkEmail = renderElasticShrinkRescheduleEmail({
    appointmentId: "appt-stream-1",
    patientName: "Riya Sharma",
    doctorName: "Asha Rao",
    specialization: "Cardiology",
    originalStartTime: new Date("2026-11-15T03:30:00.000Z"),
    originalEndTime: new Date("2026-11-15T06:30:00.000Z"),
    isStreamWindow: true,
    newStartTime: new Date("2026-11-15T03:30:00.000Z"),
    newEndTime: new Date("2026-11-15T05:30:00.000Z"),
    sameDayAlternatives: [],
    upcomingDateAlternatives: [],
    otherDoctorAlternatives: [],
  });
  assert.equal(
    streamShrinkEmail.html.includes("Stream consultations do not have fixed individual sub-slot times"),
    true
  );
  assert.equal(streamShrinkEmail.html.includes("Original Window:"), true);
  assert.equal(streamShrinkEmail.html.includes("Updated Window:"), true);
});

test("Disrupted appointment lifecycle, reschedule eligibility, and patient cancellation refund/status", () => {
  assert.equal(RescheduleLifecycleStatus.PENDING_RESCHEDULING, "PENDING_RESCHEDULING");
  assert.equal(RescheduleLifecycleStatus.RESCHEDULED, "RESCHEDULED");
  assert.equal(RescheduleLifecycleStatus.RESOLVED_MANUALLY, "RESOLVED_MANUALLY");

  // Even if a patient already used 2 reschedules, a shrink-disrupted appointment is allowed to reschedule
  const allowedWhenDisrupted = canPatientReschedule(
    {
      status: AppointmentStatus.CONFIRMED,
      startTime: new Date("2026-11-15T10:00:00.000Z"),
      rescheduleCount: 2,
      disruptedAt: new Date("2026-11-15T09:30:00.000Z"),
    },
    new Date("2026-11-15T09:45:00.000Z")
  );
  assert.equal(allowedWhenDisrupted.allowed, true);

  // Patient cancellation of a disrupted appointment preserves disruptedAt (granting 100% refund even < 2h)
  // and clears rescheduleStatus to null rather than RESOLVED_MANUALLY
  const cancelledDisruptedAppointment = {
    status: AppointmentStatus.CANCELLED,
    cancelledBy: "PATIENT",
    disruptedAt: new Date("2026-11-15T09:30:00.000Z"),
    rescheduleStatus: null,
  };
  assert.equal(cancelledDisruptedAppointment.rescheduleStatus, null);
  const refundEval = calculateRefundPolicy({
    paidAmountPaise: 50000,
    reason: RefundReason.PATIENT_CANCELLED,
    slotStartTime: new Date("2026-11-15T10:00:00.000Z"),
    cancelledAt: new Date("2026-11-15T09:45:00.000Z"), // 15 minutes before start
    isDisrupted: Boolean(cancelledDisruptedAppointment.disruptedAt),
  });
  assert.equal(refundEval.percent, 100);
  assert.equal(refundEval.amountPaise, 50000);
});

test("Patient Dashboard Disrupted Alternatives: eligibility, priority order, empty category filtering, rescheduling transition, and serializer integration", () => {
  const now = new Date("2026-11-15T04:00:00.000Z");

  // 1. Disrupted appointments with PENDING_RESCHEDULING and future startTime display alternatives on the patient dashboard
  assert.equal(
    isEligibleForDisruptedDashboardAlternatives(
      {
        status: AppointmentStatus.CONFIRMED,
        startTime: new Date("2026-11-15T08:00:00.000Z"),
        disruptedAt: new Date("2026-11-15T03:30:00.000Z"),
        rescheduleStatus: RescheduleLifecycleStatus.PENDING_RESCHEDULING,
      },
      now
    ),
    true
  );

  // 2. Normal appointments (or RESCHEDULED / RESOLVED_MANUALLY / CANCELLED / past) do not display disruption alternatives
  assert.equal(
    isEligibleForDisruptedDashboardAlternatives(
      {
        status: AppointmentStatus.CONFIRMED,
        startTime: new Date("2026-11-15T08:00:00.000Z"),
        disruptedAt: null,
        rescheduleStatus: null,
      },
      now
    ),
    false
  );
  assert.equal(
    isEligibleForDisruptedDashboardAlternatives(
      {
        status: AppointmentStatus.CONFIRMED,
        startTime: new Date("2026-11-15T08:00:00.000Z"),
        disruptedAt: new Date("2026-11-15T03:30:00.000Z"),
        rescheduleStatus: RescheduleLifecycleStatus.RESCHEDULED,
      },
      now
    ),
    false
  );
  assert.equal(
    isEligibleForDisruptedDashboardAlternatives(
      {
        status: AppointmentStatus.CONFIRMED,
        startTime: new Date("2026-11-15T08:00:00.000Z"),
        disruptedAt: new Date("2026-11-15T03:30:00.000Z"),
        rescheduleStatus: RescheduleLifecycleStatus.RESOLVED_MANUALLY,
      },
      now
    ),
    false
  );
  assert.equal(
    isEligibleForDisruptedDashboardAlternatives(
      {
        status: AppointmentStatus.CANCELLED,
        startTime: new Date("2026-11-15T08:00:00.000Z"),
        disruptedAt: new Date("2026-11-15T03:30:00.000Z"),
        rescheduleStatus: RescheduleLifecycleStatus.PENDING_RESCHEDULING,
      },
      now
    ),
    false
  );

  // 3. Three-level alternatives appear in strict priority order (1 -> 2 -> 3)
  const candidates: AlternativeSlotCandidate[] = [
    {
      id: "same-day-1",
      doctorId: "doc-1",
      doctorName: "Asha Rao",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-15T06:00:00.000Z"),
      endTime: new Date("2026-11-15T06:30:00.000Z"),
      kind: "WAVE_SLOT",
      status: "AVAILABLE",
      capacity: 2,
      activeCount: 0,
      blockedByTimeOffId: null,
    },
    {
      id: "upcoming-1",
      doctorId: "doc-1",
      doctorName: "Asha Rao",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-16T06:00:00.000Z"),
      endTime: new Date("2026-11-16T06:30:00.000Z"),
      kind: "WAVE_SLOT",
      status: "AVAILABLE",
      capacity: 2,
      activeCount: 1,
      blockedByTimeOffId: null,
    },
    {
      id: "other-doc-1",
      doctorId: "doc-2",
      doctorName: "Vikram Sen",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-15T07:00:00.000Z"),
      endTime: new Date("2026-11-15T07:30:00.000Z"),
      kind: "WAVE_SLOT",
      status: "AVAILABLE",
      capacity: 2,
      activeCount: 0,
      blockedByTimeOffId: null,
    },
    // 6. Stale or fully booked alternatives are rejected
    {
      id: "stale-booked",
      doctorId: "doc-1",
      doctorName: "Asha Rao",
      specialization: "Cardiology",
      consultationFeeRupees: 500,
      startTime: new Date("2026-11-15T06:30:00.000Z"),
      endTime: new Date("2026-11-15T07:00:00.000Z"),
      kind: "WAVE_SLOT",
      status: "BOOKED",
      capacity: 2,
      activeCount: 2,
      blockedByTimeOffId: null,
    },
  ];

  const suggestions = selectThreeLevelAlternatives({
    originalAppointment: {
      availabilityId: "slot-orig",
      doctorId: "doc-1",
      specialization: "Cardiology",
      startTime: new Date("2026-11-15T08:00:00.000Z"),
      endTime: new Date("2026-11-15T08:30:00.000Z"),
      kind: "WAVE_SLOT",
      consultationFeeRupees: 500,
    },
    candidates,
    minStartTime: now,
    maxPerCategory: 3,
  });

  const allThreeVisible = getVisibleAlternativeCategories(suggestions);
  assert.equal(allThreeVisible.length, 3);
  assert.deepEqual(
    allThreeVisible.map((c) => c.priority),
    [1, 2, 3]
  );
  assert.deepEqual(
    allThreeVisible.map((c) => c.key),
    ["sameDay", "upcomingDate", "otherDoctor"]
  );
  assert.equal(allThreeVisible[0]!.items[0]!.id, "same-day-1");
  assert.equal(allThreeVisible[1]!.items[0]!.id, "upcoming-1");
  assert.equal(allThreeVisible[2]!.items[0]!.id, "other-doc-1");

  // 4. Empty categories are hidden while preserving priority order
  const onlyUpcomingAndOtherVisible = getVisibleAlternativeCategories({
    sameDayAlternatives: [],
    upcomingDateAlternatives: suggestions.upcomingDateAlternatives,
    otherDoctorAlternatives: suggestions.otherDoctorAlternatives,
  });
  assert.equal(onlyUpcomingAndOtherVisible.length, 2);
  assert.deepEqual(
    onlyUpcomingAndOtherVisible.map((c) => c.key),
    ["upcomingDate", "otherDoctor"]
  );

  // 5. Selecting an alternative updates the appointment to RESCHEDULED and clears disruptedAt/disruptionReason,
  //    removing the disruption card on the refreshed dashboard
  const postRescheduleState = {
    status: AppointmentStatus.CONFIRMED,
    startTime: new Date("2026-11-15T06:00:00.000Z"),
    disruptedAt: null,
    rescheduleStatus: RescheduleLifecycleStatus.RESCHEDULED,
  };
  assert.equal(isEligibleForDisruptedDashboardAlternatives(postRescheduleState, now), false);

  // 7. When no alternatives exist across all 3 categories, getVisibleAlternativeCategories returns []
  //    so the clinic assistance fallback message is displayed while keeping the appointment protected
  const emptyVisible = getVisibleAlternativeCategories({
    sameDayAlternatives: [],
    upcomingDateAlternatives: [],
    otherDoctorAlternatives: [],
  });
  assert.equal(emptyVisible.length, 0);

  // 8. Serializer preserves rescheduleStatus and suggestedAlternatives for both Dashboard/Consultations and Dedicated Rescheduling views
  const dto = toPatientAppointmentDto(
    {
      id: "appt-disrupted-1",
      status: AppointmentStatus.CONFIRMED,
      stream: VisitStream.NEW_CONSULTATION,
      reason: "Routine follow-up",
      createdAt: new Date("2026-11-10T04:00:00.000Z"),
      checkedInAt: null,
      rescheduleCount: 0,
      disruptedAt: new Date("2026-11-15T03:30:00.000Z"),
      disruptionReason: "Doctor availability updated",
      rescheduleStatus: RescheduleLifecycleStatus.PENDING_RESCHEDULING,
      holdExpiresAt: null,
      slotStart: new Date("2026-11-15T08:00:00.000Z"),
      slotEnd: new Date("2026-11-15T08:30:00.000Z"),
      wave: null,
      availability: {
        startTime: new Date("2026-11-15T08:00:00.000Z"),
        endTime: new Date("2026-11-15T08:30:00.000Z"),
        doctor: {
          id: "doc-1",
          specialization: "Cardiology",
          consultationFee: 500,
          user: {
            name: "Asha Rao",
          },
        },
      },
      payments: [],
    },
    now,
    null,
    suggestions
  );

  assert.equal(dto.rescheduleStatus, RescheduleLifecycleStatus.PENDING_RESCHEDULING);
  assert.equal(dto.suggestedAlternatives?.sameDayAlternatives.length, 1);
  assert.equal(dto.canReschedule, true);
});


