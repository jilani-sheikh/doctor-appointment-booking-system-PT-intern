import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AppointmentStatus,
  AvailabilityKind,
  DoctorStatus,
  Role,
  VisitStream,
  WaveStatus,
} from "../src/generated/prisma/enums";
import {
  canMarkNoShow,
  canPatientCheckIn,
  canReceptionistCallNext,
  canReceptionistComplete,
  canReceptionistStartConsultation,
  canStaffCheckIn,
  isValidTransition,
} from "../src/lib/appointment-status";
import { buildDoctorLiveQueueData } from "../src/lib/doctor-queue";
import { calculateSubSlotQueues } from "../src/lib/queue";
import {
  allocateSubSlotToken,
  buildSubSlotQueueScopeKey,
  formatDoctorCalledNotification,
  formatSubSlotLabel,
  getQueueStatusLabel,
  pickNextCallableAppointment,
} from "../src/lib/queue-tokens";
import {
  executeCallNextPatient,
  executeMarkCompleted,
  executeMarkNotArrived,
  executeStartConsultation,
  type CallNextCandidateRecord,
  type CallNextTxAdapter,
  type StaffOutcomeTxAdapter,
} from "../src/lib/queue-actions-core";
import { buildReceptionistDashboardData } from "../src/lib/receptionist";
import { toPatientAppointmentDto } from "../src/lib/serializers";
import { createISTDate } from "../src/lib/time";

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function createInMemoryAvailabilityTokenStore() {
  const slots = new Map<
    string,
    { id: string; doctorId: string; startTime: Date; tokenCounter: number; lockChain: Promise<void> }
  >();

  return {
    registerSlot(slot: { id: string; doctorId: string; startTime: Date; initialCounter?: number }) {
      slots.set(slot.id, {
        id: slot.id,
        doctorId: slot.doctorId,
        startTime: slot.startTime,
        tokenCounter: slot.initialCounter ?? 0,
        lockChain: Promise.resolve(),
      });
    },
    async runSerializedAllocate(availabilityId: string) {
      const slot = slots.get(availabilityId);
      if (!slot) throw new Error("SLOT_UNAVAILABLE");

      const prevLock = slot.lockChain;
      let release!: () => void;
      slot.lockChain = new Promise<void>((res) => {
        release = res;
      });

      await prevLock;
      try {
        // Yield briefly to exercise async race interleaving
        await new Promise((res) => setTimeout(res, 5));
        const txMock = {
          $queryRaw: async () => {
            slot.tokenCounter += 1;
            return [
              {
                token_counter: slot.tokenCounter,
                doctor_id: slot.doctorId,
                start_time: slot.startTime,
              },
            ];
          },
        } as unknown as Parameters<typeof allocateSubSlotToken>[0];

        return await allocateSubSlotToken(txMock, availabilityId);
      } finally {
        release();
      }
    },
    getCounter(availabilityId: string) {
      return slots.get(availabilityId)?.tokenCounter ?? 0;
    },
  };
}

function createInMemoryQueueWorkflowHarness(seed: {
  doctors?: Array<{
    id: string;
    userId: string;
    status: DoctorStatus;
    name: string | null;
  }>;
  availabilities: Array<{
    id: string;
    doctorId: string;
    kind: AvailabilityKind;
    startTime: Date;
    endTime: Date;
  }>;
  appointments: Array<{
    id: string;
    availabilityId: string;
    patientUserId: string;
    patientName: string;
    status: AppointmentStatus;
    tokenNumber: number | null;
    checkedInAt?: Date | null;
    calledAt?: Date | null;
    noShowAt?: Date | null;
    completedAt?: Date | null;
    actualStartAt?: Date | null;
    actualEndAt?: Date | null;
    createdAt: Date;
  }>;
}) {
  const doctorLocks = new Map<string, Promise<void>>();
  const doctors = seed.doctors ?? [
    {
      id: "doc_1",
      userId: "u_doc_1",
      status: DoctorStatus.APPROVED,
      name: "Dr. Ananya Sharma",
    },
  ];
  const appts = seed.appointments.map((a) => ({
    ...a,
    checkedInAt: a.checkedInAt ?? null,
    calledAt: a.calledAt ?? null,
    calledByUserId: null as string | null,
    noShowAt: a.noShowAt ?? null,
    noShowByUserId: null as string | null,
    completedAt: a.completedAt ?? null,
    completedByUserId: null as string | null,
    actualStartAt: a.actualStartAt ?? null,
    actualEndAt: a.actualEndAt ?? null,
    slotStart: null as Date | null,
    slotEnd: null as Date | null,
    skippedReminders: [] as Array<{ appointmentId: string; status: AppointmentStatus }>,
  }));

  const findAvail = (id: string) => seed.availabilities.find((a) => a.id === id) ?? null;

  async function withDoctorLock<T>(doctorId: string, fn: () => Promise<T>): Promise<T> {
    const prev = doctorLocks.get(doctorId) ?? Promise.resolve();
    let release!: () => void;
    doctorLocks.set(
      doctorId,
      new Promise<void>((res) => {
        release = res;
      })
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  const callAdapter = (doctorId: string): {
    run: <T>(fn: (tx: CallNextTxAdapter) => Promise<T>) => Promise<T>;
  } => ({
    run: (fn) =>
      withDoctorLock(doctorId, async () => {
        const tx: CallNextTxAdapter = {
          findDoctor: async (docId) => doctors.find((d) => d.id === docId) ?? null,
          lockDoctor: async () => {
            await new Promise((res) => setTimeout(res, 5));
          },
          findAvailability: async (availId) => findAvail(availId),
          findActiveDoctorCallOnDay: async ({ doctorId: docId, dayStart, nextDayStart }) => {
            const found = appts.find((ap) => {
              const av = findAvail(ap.availabilityId);
              if (!av || av.doctorId !== docId) return false;
              const t = av.startTime.getTime();
              if (t < dayStart.getTime() || t >= nextDayStart.getTime()) return false;
              return (
                ap.status === AppointmentStatus.CALLED ||
                ap.status === AppointmentStatus.IN_CONSULTATION
              );
            });
            return found
              ? {
                  id: found.id,
                  status: found.status,
                  tokenNumber: found.tokenNumber,
                  patientName: found.patientName,
                }
              : null;
          },
          findSubSlotCheckedInCandidates: async (availId) =>
            appts
              .filter(
                (ap) =>
                  ap.availabilityId === availId &&
                  ap.status === AppointmentStatus.CHECKED_IN
              )
              .map<CallNextCandidateRecord>((ap) => ({
                id: ap.id,
                status: ap.status,
                tokenNumber: ap.tokenNumber,
                checkedInAt: ap.checkedInAt,
                createdAt: ap.createdAt,
                actualStartAt: ap.actualStartAt,
                slotStart: ap.slotStart,
                slotEnd: ap.slotEnd,
                patientUserId: ap.patientUserId,
                patientName: ap.patientName,
              })),
          conditionalMarkCalled: async ({ appointmentId, calledAt, calledByUserId }) => {
            const target = appts.find((ap) => ap.id === appointmentId);
            if (!target || target.status !== AppointmentStatus.CHECKED_IN) return 0;
            target.status = AppointmentStatus.CALLED;
            target.calledAt = calledAt;
            target.calledByUserId = calledByUserId;
            return 1;
          },
          syncReminders: async ({ appointmentId, status }) => {
            const target = appts.find((ap) => ap.id === appointmentId);
            target?.skippedReminders.push({ appointmentId, status });
          },
        };
        return await fn(tx);
      }),
  });

  const staffAdapter = (): StaffOutcomeTxAdapter => ({
    findAppointment: async (appointmentId) => {
      const target = appts.find((ap) => ap.id === appointmentId);
      if (!target) return null;
      const av = findAvail(target.availabilityId)!;
      return {
        id: target.id,
        doctorId: av.doctorId,
        availabilityId: target.availabilityId,
        patientUserId: target.patientUserId,
        status: target.status,
        slotStartTime: av.startTime,
        actualStartAt: target.actualStartAt,
        actualEndAt: target.actualEndAt,
      };
    },
    findActiveInConsultationOnDay: async ({ doctorId, dayStart, nextDayStart, excludeAppointmentId }) => {
      const found = appts.find((ap) => {
        if (ap.id === excludeAppointmentId) return false;
        const av = findAvail(ap.availabilityId);
        if (!av || av.doctorId !== doctorId) return false;
        const t = av.startTime.getTime();
        if (t < dayStart.getTime() || t >= nextDayStart.getTime()) return false;
        return ap.status === AppointmentStatus.IN_CONSULTATION;
      });
      return found ? { id: found.id } : null;
    },
    conditionalStartConsultation: async ({ appointmentId, actualStartAt }) => {
      const target = appts.find((ap) => ap.id === appointmentId);
      if (!target || target.status !== AppointmentStatus.CALLED) {
        return 0;
      }
      target.status = AppointmentStatus.IN_CONSULTATION;
      target.actualStartAt = actualStartAt;
      return 1;
    },
    conditionalMarkNoShow: async ({ appointmentId, noShowAt, noShowByUserId }) => {
      const target = appts.find((ap) => ap.id === appointmentId);
      if (
        !target ||
        (target.status !== AppointmentStatus.CONFIRMED &&
          target.status !== AppointmentStatus.CHECKED_IN &&
          target.status !== AppointmentStatus.CALLED)
      ) {
        return 0;
      }
      target.status = AppointmentStatus.NO_SHOW;
      target.noShowAt = noShowAt;
      target.noShowByUserId = noShowByUserId;
      return 1;
    },
    conditionalMarkCompleted: async ({
      appointmentId,
      completedAt,
      completedByUserId,
      actualStartAt,
      actualEndAt,
    }) => {
      const target = appts.find((ap) => ap.id === appointmentId);
      if (!target || target.status !== AppointmentStatus.IN_CONSULTATION) {
        return 0;
      }
      target.status = AppointmentStatus.COMPLETED;
      target.completedAt = completedAt;
      target.completedByUserId = completedByUserId;
      target.actualStartAt = target.actualStartAt ?? actualStartAt;
      target.actualEndAt = actualEndAt;
      return 1;
    },
    syncReminders: async ({ appointmentId, status }) => {
      const target = appts.find((ap) => ap.id === appointmentId);
      target?.skippedReminders.push({ appointmentId, status });
    },
  });

  return { appts, callAdapter, staffAdapter };
}

test("Scenario 1-4: Independent persisted token generation per (Doctor, Date IST, Wave sub-slot / Stream window) & concurrency safety", async () => {
  const tokenStore = createInMemoryAvailabilityTokenStore();
  const slotA1 = createISTDate(2026, 11, 20, 10, 0);
  const slotA2 = createISTDate(2026, 11, 20, 10, 30);
  const slotB1 = createISTDate(2026, 11, 20, 10, 30);
  const streamB = createISTDate(2026, 11, 20, 14, 0);
  const slotADay2 = createISTDate(2026, 11, 21, 10, 0);

  tokenStore.registerSlot({ id: "av_a_wave1", doctorId: "doc_a", startTime: slotA1 });
  tokenStore.registerSlot({ id: "av_a_wave2", doctorId: "doc_a", startTime: slotA2 });
  tokenStore.registerSlot({ id: "av_b_wave1", doctorId: "doc_b", startTime: slotB1 });
  tokenStore.registerSlot({ id: "av_b_stream", doctorId: "doc_b", startTime: streamB });
  tokenStore.registerSlot({ id: "av_a_nextday", doctorId: "doc_a", startTime: slotADay2 });

  // Concurrent bookings in Doctor A's 10:00 AM Wave sub-slot yield strict unique #1 and #2
  const [a1t1, a1t2] = await Promise.all([
    tokenStore.runSerializedAllocate("av_a_wave1"),
    tokenStore.runSerializedAllocate("av_a_wave1"),
  ]);
  assert.deepEqual([a1t1.tokenNumber, a1t2.tokenNumber].sort(), [1, 2]);
  assert.equal(a1t1.queueScopeKey, "doc_a:2026-11-20:av_a_wave1");
  assert.equal(a1t2.queueScopeKey, "doc_a:2026-11-20:av_a_wave1");

  // Doctor A's 10:30 AM Wave sub-slot starts independently at #1
  const a2t1 = await tokenStore.runSerializedAllocate("av_a_wave2");
  assert.equal(a2t1.tokenNumber, 1);
  assert.equal(a2t1.queueScopeKey, "doc_a:2026-11-20:av_a_wave2");

  // Doctor B's 10:30 AM sub-slot starts independently at #1
  const b1t1 = await tokenStore.runSerializedAllocate("av_b_wave1");
  assert.equal(b1t1.tokenNumber, 1);
  assert.equal(b1t1.queueScopeKey, "doc_b:2026-11-20:av_b_wave1");

  // Stream window queue starts independently at #1, #2
  const bStream1 = await tokenStore.runSerializedAllocate("av_b_stream");
  const bStream2 = await tokenStore.runSerializedAllocate("av_b_stream");
  assert.equal(bStream1.tokenNumber, 1);
  assert.equal(bStream2.tokenNumber, 2);
  assert.notEqual(bStream1.queueScopeKey, b1t1.queueScopeKey);

  // Next IST day starts independently at #1
  const aDay2 = await tokenStore.runSerializedAllocate("av_a_nextday");
  assert.equal(aDay2.tokenNumber, 1);
  assert.equal(aDay2.queueScopeKey, "doc_a:2026-11-21:av_a_nextday");
});

test("Scenario 5-6: Token numbers persist & never shift when earlier patient cancels or marks Not Arrived while live Queue Position updates", () => {
  const slotStart = createISTDate(2026, 11, 20, 10, 0);
  const slotEnd = createISTDate(2026, 11, 20, 10, 30);
  const now = createISTDate(2026, 11, 20, 10, 18);
  const scopeKey = buildSubSlotQueueScopeKey({
    doctorId: "doc_a",
    startTime: slotStart,
    availabilityId: "av_wave_10",
  });

  // Initially 3 patients in same Wave sub-slot: Tokens #1, #2, #3
  const baseSubSlot = [
    {
      id: "ap1",
      status: AppointmentStatus.CONFIRMED,
      scheduledStart: slotStart,
      scheduledEnd: slotEnd,
      tokenNumber: 1,
      createdAt: createISTDate(2026, 11, 19, 9, 0),
      queueScopeKey: scopeKey,
    },
    {
      id: "ap2",
      status: AppointmentStatus.CHECKED_IN,
      scheduledStart: slotStart,
      scheduledEnd: slotEnd,
      tokenNumber: 2,
      createdAt: createISTDate(2026, 11, 19, 9, 1),
      queueScopeKey: scopeKey,
    },
    {
      id: "ap3",
      status: AppointmentStatus.CHECKED_IN,
      scheduledStart: slotStart,
      scheduledEnd: slotEnd,
      tokenNumber: 3,
      createdAt: createISTDate(2026, 11, 19, 9, 2),
      queueScopeKey: scopeKey,
    },
  ];

  const initial = calculateSubSlotQueues(baseSubSlot, now);
  assert.equal(initial.estimates.get("ap1")?.queuePosition, 1);
  assert.equal(initial.estimates.get("ap2")?.queuePosition, 2);
  assert.equal(initial.estimates.get("ap3")?.queuePosition, 3);

  // Patient 1 is CANCELLED and Patient 2 is NO_SHOW: Patient 3's queuePosition shifts to #1,
  // while Receptionist & Doctor views preserve persisted Token #3 untouched.
  const afterRemovals = baseSubSlot.map((ap) =>
    ap.id === "ap1"
      ? { ...ap, status: AppointmentStatus.CANCELLED }
      : ap.id === "ap2"
        ? { ...ap, status: AppointmentStatus.NO_SHOW }
        : ap
  );

  const updated = calculateSubSlotQueues(afterRemovals, now);
  assert.equal(updated.estimates.get("ap1"), undefined);
  assert.equal(updated.estimates.get("ap2"), undefined);
  assert.equal(updated.estimates.get("ap3")?.queuePosition, 1);

  const recProjection = buildReceptionistDashboardData(
    afterRemovals.map((ap, i) => ({
      id: ap.id,
      availabilityId: "av_wave_10",
      tokenNumber: i + 1,
      queueScopeKey: scopeKey,
      status: ap.status,
      stream: VisitStream.NEW_CONSULTATION,
      patient: { id: `p${i}`, phone: null, user: { name: `Patient ${i + 1}`, email: null } },
      availability: {
        id: "av_wave_10",
        kind: AvailabilityKind.WAVE_SLOT,
        startTime: slotStart,
        endTime: slotEnd,
        doctor: { id: "doc_a", specialization: "General", user: { name: "Sharma" } },
      },
    })),
    now
  );

  const ap3Row = recProjection.appointments.find((r) => r.id === "ap3")!;
  assert.equal(ap3Row.tokenNumber, 3); // Persisted Token #3 unchanged!
  assert.equal(ap3Row.queuePosition, 1); // Dynamic live position shifted to #1!
});

test("Scenario 7-11: Doctor Call Next Patient concurrency, notification message, and Receptionist Check-In / Not Arrived / Completed lifecycle", async () => {
  const slot1000Start = createISTDate(2026, 11, 20, 10, 0);
  const slot1000End = createISTDate(2026, 11, 20, 10, 30);
  const slot1030Start = createISTDate(2026, 11, 20, 10, 30);
  const slot1030End = createISTDate(2026, 11, 20, 11, 0);

  const harness = createInMemoryQueueWorkflowHarness({
    doctors: [
      {
        id: "doc_1",
        userId: "u_doc_1",
        status: DoctorStatus.APPROVED,
        name: "Dr. Ananya Sharma",
      },
      {
        id: "doc_2",
        userId: "u_doc_2",
        status: DoctorStatus.APPROVED,
        name: "Dr. Vikram Patel",
      },
    ],
    availabilities: [
      {
        id: "av_1000",
        doctorId: "doc_1",
        kind: AvailabilityKind.WAVE_SLOT,
        startTime: slot1000Start,
        endTime: slot1000End,
      },
      {
        id: "av_1030",
        doctorId: "doc_1",
        kind: AvailabilityKind.WAVE_SLOT,
        startTime: slot1030Start,
        endTime: slot1030End,
      },
    ],
    appointments: [
      // Token #1 is still CONFIRMED (not checked in yet -> MUST be skipped by Call Next Patient)
      {
        id: "a_t1_confirmed",
        availabilityId: "av_1000",
        patientUserId: "u_p1",
        patientName: "Amit Verma",
        status: AppointmentStatus.CONFIRMED,
        tokenNumber: 1,
        createdAt: createISTDate(2026, 11, 19, 8, 0),
      },
      // Token #2 is CHECKED_IN -> should be called first!
      {
        id: "a_t2_checkedin",
        availabilityId: "av_1000",
        patientUserId: "u_p2",
        patientName: "Neha Singh",
        status: AppointmentStatus.CHECKED_IN,
        tokenNumber: 2,
        checkedInAt: createISTDate(2026, 11, 20, 9, 52),
        createdAt: createISTDate(2026, 11, 19, 8, 5),
      },
      // Token #3 is CHECKED_IN -> second in line
      {
        id: "a_t3_checkedin",
        availabilityId: "av_1000",
        patientUserId: "u_p3",
        patientName: "Ravi Kumar",
        status: AppointmentStatus.CHECKED_IN,
        tokenNumber: 3,
        checkedInAt: createISTDate(2026, 11, 20, 9, 55),
        createdAt: createISTDate(2026, 11, 19, 8, 10),
      },
      // Sub-slot 10:30 Token #1 is CHECKED_IN -> independent sub-slot
      {
        id: "b_t1_checkedin",
        availabilityId: "av_1030",
        patientUserId: "u_p4",
        patientName: "Sana Ali",
        status: AppointmentStatus.CHECKED_IN,
        tokenNumber: 1,
        checkedInAt: createISTDate(2026, 11, 20, 10, 10),
        createdAt: createISTDate(2026, 11, 19, 8, 15),
      },
    ],
  });

  const doctorActor = { id: "u_doc_1", role: Role.DOCTOR };
  const receptionistActor = { id: "u_rec_1", role: Role.RECEPTIONIST };

  // Doctors and Admins are BOTH blocked server-side from operational queue/consultation mutations
  for (const blockedActor of [
    doctorActor,
    { id: "u_admin_1", role: Role.ADMIN },
  ]) {
    const callRejected = await harness.callAdapter("doc_1").run((tx) =>
      executeCallNextPatient({
        tx,
        actor: blockedActor,
        doctorId: "doc_1",
        availabilityId: "av_1000",
      })
    );
    assert.equal(callRejected.success, false);
    const startRejected = await executeStartConsultation({
      tx: harness.staffAdapter(),
      actor: blockedActor,
      appointmentId: "a_t2_checkedin",
    });
    assert.equal(startRejected.success, false);
    const completeRejected = await executeMarkCompleted({
      tx: harness.staffAdapter(),
      actor: blockedActor,
      appointmentId: "a_t2_checkedin",
    });
    assert.equal(completeRejected.success, false);
    const noShowRejected = await executeMarkNotArrived({
      tx: harness.staffAdapter(),
      actor: blockedActor,
      appointmentId: "a_t1_confirmed",
      now: createISTDate(2026, 11, 20, 10, 20),
    });
    assert.equal(noShowRejected.success, false);
  }

  // Receptionist cross-doctor availability mismatch on Call Next Patient is rejected
  const crossDoctorCall = await harness.callAdapter("doc_2").run((tx) =>
    executeCallNextPatient({
      tx,
      actor: receptionistActor,
      doctorId: "doc_2",
      availabilityId: "av_1000",
    })
  );
  assert.equal(crossDoctorCall.success, false);

  // Receptionist tries invalid premature completion on CHECKED_IN -> rejected!
  const prematureComplete = await executeMarkCompleted({
    tx: harness.staffAdapter(),
    actor: receptionistActor,
    appointmentId: "a_t2_checkedin",
  });
  assert.equal(prematureComplete.success, false);

  // Receptionist tries Not Arrived BEFORE 15m grace window -> rejected!
  const earlyNoShow = await executeMarkNotArrived({
    tx: harness.staffAdapter(),
    actor: receptionistActor,
    appointmentId: "a_t1_confirmed",
    now: createISTDate(2026, 11, 20, 10, 10),
  });
  assert.equal(earlyNoShow.success, false);
  assert.match(earlyNoShow.error || "", /15 minutes after/);

  // Concurrent double-click of Receptionist Call Next Patient -> ONLY ONE succeeds, Token #2 CALLED, Token #3 untouched!
  const callTime = createISTDate(2026, 11, 20, 10, 5);
  const [call1, call2] = await Promise.all([
    harness.callAdapter("doc_1").run((tx) =>
      executeCallNextPatient({
        tx,
        actor: receptionistActor,
        doctorId: "doc_1",
        availabilityId: "av_1000",
        now: callTime,
      })
    ),
    harness.callAdapter("doc_1").run((tx) =>
      executeCallNextPatient({
        tx,
        actor: receptionistActor,
        doctorId: "doc_1",
        availabilityId: "av_1000",
        now: callTime,
      })
    ),
  ]);

  const callSuccesses = [call1, call2].filter((r) => r.success);
  const callFailures = [call1, call2].filter((r) => !r.success);
  assert.equal(callSuccesses.length, 1);
  assert.equal(callFailures.length, 1);

  const succeededCall = callSuccesses[0]!;
  assert.equal(succeededCall.appointmentId, "a_t2_checkedin");
  assert.equal(succeededCall.tokenNumber, 2);
  assert.equal(succeededCall.doctorUserId, "u_doc_1");
  assert.equal(succeededCall.patientUserId, "u_p2");
  assert.match(
    succeededCall.notification?.title ?? "",
    /^Next Patient Called by Reception$/
  );
  assert.match(
    succeededCall.notification?.body ?? "",
    /Reception Desk called Patient Neha Singh – Token #2 for Dr\. Ananya Sharma \(Wave Sub-slot 10:00 am - 10:30 am IST, 10:05 am IST\)/i
  );

  const calledRow = harness.appts.find((a) => a.id === "a_t2_checkedin")!;
  assert.equal(calledRow.status, AppointmentStatus.CALLED);
  assert.equal(calledRow.calledByUserId, "u_rec_1");
  assert.equal(calledRow.calledAt?.toISOString(), callTime.toISOString());
  // actualStartAt is NOT set at Call Next Patient; only stamped when consultation actually starts
  assert.equal(calledRow.actualStartAt, null);
  assert.equal(calledRow.tokenNumber, 2);
  assert.equal(calledRow.skippedReminders.length, 1);

  // Completing directly from CALLED (without Start Consultation) is blocked!
  const skipStartComplete = await executeMarkCompleted({
    tx: harness.staffAdapter(),
    actor: receptionistActor,
    appointmentId: "a_t2_checkedin",
    expectedDoctorId: "doc_1",
    expectedAvailabilityId: "av_1000",
    now: createISTDate(2026, 11, 20, 10, 7),
  });
  assert.equal(skipStartComplete.success, false);

  // Receptionist Start Consultation with mismatched doctor scope is rejected
  const wrongScopeStart = await executeStartConsultation({
    tx: harness.staffAdapter(),
    actor: receptionistActor,
    appointmentId: "a_t2_checkedin",
    expectedDoctorId: "doc_2",
    expectedAvailabilityId: "av_1000",
    now: createISTDate(2026, 11, 20, 10, 8),
  });
  assert.equal(wrongScopeStart.success, false);

  // Receptionist Start Consultation (CALLED -> IN_CONSULTATION) stamps actualStartAt
  const startTime = createISTDate(2026, 11, 20, 10, 8);
  const startOk = await executeStartConsultation({
    tx: harness.staffAdapter(),
    actor: receptionistActor,
    appointmentId: "a_t2_checkedin",
    expectedDoctorId: "doc_1",
    expectedAvailabilityId: "av_1000",
    now: startTime,
  });
  assert.equal(startOk.success, true);
  assert.equal(calledRow.status, AppointmentStatus.IN_CONSULTATION);
  assert.equal(
    (harness.appts.find((a) => a.id === "a_t2_checkedin")!.actualStartAt as Date | null)?.toISOString(),
    startTime.toISOString()
  );

  // Duplicate Call Next Patient in sub-slot 10:30 while doctor has active IN_CONSULTATION is blocked!
  const blockedSecondCall = await harness.callAdapter("doc_1").run((tx) =>
    executeCallNextPatient({
      tx,
      actor: receptionistActor,
      doctorId: "doc_1",
      availabilityId: "av_1030",
      now: createISTDate(2026, 11, 20, 10, 10),
    })
  );
  assert.equal(blockedSecondCall.success, false);

  // Receptionist marks a_t1_confirmed as Not Arrived AFTER 15m grace window -> NO_SHOW recorded with audit!
  const noShowTime = createISTDate(2026, 11, 20, 10, 16);
  const noShowOk = await executeMarkNotArrived({
    tx: harness.staffAdapter(),
    actor: receptionistActor,
    appointmentId: "a_t1_confirmed",
    expectedDoctorId: "doc_1",
    expectedAvailabilityId: "av_1000",
    now: noShowTime,
  });
  assert.equal(noShowOk.success, true);
  const noShowRow = harness.appts.find((a) => a.id === "a_t1_confirmed")!;
  assert.equal(noShowRow.status, AppointmentStatus.NO_SHOW);
  assert.equal(noShowRow.noShowByUserId, "u_rec_1");
  assert.equal(noShowRow.tokenNumber, 1);

  // Receptionist marks IN_CONSULTATION -> COMPLETED + preserves actualStartAt..actualEndAt duration + duplicate prevented!
  const completeTime = createISTDate(2026, 11, 20, 10, 18);
  const completeOk = await executeMarkCompleted({
    tx: harness.staffAdapter(),
    actor: receptionistActor,
    appointmentId: "a_t2_checkedin",
    expectedDoctorId: "doc_1",
    expectedAvailabilityId: "av_1000",
    now: completeTime,
  });
  assert.equal(completeOk.success, true);
  assert.equal(calledRow.status, AppointmentStatus.COMPLETED);
  assert.equal(calledRow.completedByUserId, "u_rec_1");
  assert.equal(calledRow.completedAt?.toISOString(), completeTime.toISOString());
  assert.equal(
    (harness.appts.find((a) => a.id === "a_t2_checkedin")!.actualStartAt as Date | null)?.toISOString(),
    startTime.toISOString()
  );
  assert.equal(
    (harness.appts.find((a) => a.id === "a_t2_checkedin")!.actualEndAt as Date | null)?.toISOString(),
    completeTime.toISOString()
  );
  assert.equal(calledRow.tokenNumber, 2);

  // Completing again (stale duplicate click) is blocked!
  const duplicateComplete = await executeMarkCompleted({
    tx: harness.staffAdapter(),
    actor: receptionistActor,
    appointmentId: "a_t2_checkedin",
    now: completeTime,
  });
  assert.equal(duplicateComplete.success, false);

  // Now Receptionist can call Token #3 in av_1000!
  const nextCall = await harness.callAdapter("doc_1").run((tx) =>
    executeCallNextPatient({
      tx,
      actor: receptionistActor,
      doctorId: "doc_1",
      availabilityId: "av_1000",
      now: createISTDate(2026, 11, 20, 10, 19),
    })
  );
  assert.equal(nextCall.success, true);
  assert.equal(nextCall.appointmentId, "a_t3_checkedin");
  assert.equal(nextCall.tokenNumber, 3);
});

test("Scenario 12-13: Doctor Live Queue isolation, Patient Portal DTO sub-slot/token accuracy, and strict RBAC enforcement", async () => {
  const slotStart = createISTDate(2026, 11, 20, 10, 0);
  const slotEnd = createISTDate(2026, 11, 20, 10, 30);
  const wave2Start = createISTDate(2026, 11, 20, 10, 30);
  const wave2End = createISTDate(2026, 11, 20, 11, 0);
  const now = createISTDate(2026, 11, 20, 10, 10);

  // Doctor live queue projection is read-only, includes Not Arrived visibility, separates sub-slots cleanly & hides PENDING_PAYMENT
  const docQueue = buildDoctorLiveQueueData(
    [
      {
        id: "dq_hold",
        availabilityId: "av_1",
        status: AppointmentStatus.PENDING_PAYMENT,
        tokenNumber: null,
        queueScopeKey: null,
        checkedInAt: null,
        calledAt: null,
        completedAt: null,
        actualStartAt: null,
        actualEndAt: null,
        createdAt: slotStart,
        slotStart: null,
        slotEnd: null,
        patient: { id: "p_hold", user: { name: "Hold Patient" } },
        availability: { id: "av_1", doctorId: "d1", kind: AvailabilityKind.WAVE_SLOT, startTime: slotStart, endTime: slotEnd },
      },
      {
        id: "dq_called",
        availabilityId: "av_1",
        status: AppointmentStatus.CALLED,
        tokenNumber: 1,
        queueScopeKey: "d1:2026-11-20:av_1",
        checkedInAt: createISTDate(2026, 11, 20, 9, 45),
        calledAt: createISTDate(2026, 11, 20, 10, 5),
        completedAt: null,
        actualStartAt: null,
        actualEndAt: null,
        createdAt: slotStart,
        slotStart: null,
        slotEnd: null,
        patient: { id: "p1", user: { name: "First Called" } },
        availability: { id: "av_1", doctorId: "d1", kind: AvailabilityKind.WAVE_SLOT, startTime: slotStart, endTime: slotEnd },
      },
      {
        id: "dq_noshow",
        availabilityId: "av_1",
        status: AppointmentStatus.NO_SHOW,
        tokenNumber: 2,
        queueScopeKey: "d1:2026-11-20:av_1",
        checkedInAt: null,
        calledAt: null,
        completedAt: null,
        actualStartAt: null,
        actualEndAt: null,
        createdAt: slotStart,
        slotStart: null,
        slotEnd: null,
        patient: { id: "p_ns", user: { name: "Missed Patient" } },
        availability: { id: "av_1", doctorId: "d1", kind: AvailabilityKind.WAVE_SLOT, startTime: slotStart, endTime: slotEnd },
      },
      {
        id: "dq_wave2_wait",
        availabilityId: "av_2",
        status: AppointmentStatus.CHECKED_IN,
        tokenNumber: 1,
        queueScopeKey: "d1:2026-11-20:av_2",
        checkedInAt: createISTDate(2026, 11, 20, 9, 55),
        calledAt: null,
        completedAt: null,
        actualStartAt: null,
        actualEndAt: null,
        createdAt: wave2Start,
        slotStart: null,
        slotEnd: null,
        patient: { id: "p2", user: { name: "Wave 2 Patient" } },
        availability: { id: "av_2", doctorId: "d1", kind: AvailabilityKind.WAVE_SLOT, startTime: wave2Start, endTime: wave2End },
      },
    ],
    now
  );

  assert.equal(docQueue.subSlots.length, 2);
  assert.equal(docQueue.activeDoctorCall?.appointmentId, "dq_called");
  assert.equal(docQueue.subSlots[0]?.noShowCount, 1);
  assert.equal(docQueue.subSlots[0]?.notArrivedPatients.length, 1);
  assert.equal(docQueue.subSlots[0]?.activePatients.length, 1); // PENDING_PAYMENT and NO_SHOW excluded from active queue positions
  assert.equal("canCallNext" in (docQueue.subSlots[1] ?? {}), false);

  // Receptionist Dashboard centralizes Doctor + Date + Sub-Slot selection and Call Next / Start / Complete controls
  const recData = buildReceptionistDashboardData(
    [
      {
        id: "rq_checked",
        availabilityId: "av_2",
        status: AppointmentStatus.CHECKED_IN,
        stream: VisitStream.NEW_CONSULTATION,
        tokenNumber: 1,
        queueScopeKey: "d1:2026-11-20:av_2",
        checkedInAt: createISTDate(2026, 11, 20, 9, 55),
        calledAt: null,
        actualStartAt: null,
        createdAt: wave2Start,
        patient: { id: "p2", phone: "9999999999", user: { name: "Wave 2 Patient" } },
        availability: {
          id: "av_2",
          kind: AvailabilityKind.WAVE_SLOT,
          startTime: wave2Start,
          endTime: wave2End,
          doctor: {
            id: "d1",
            specialization: "Dermatology",
            user: { name: "Dr. Meera" },
          },
        },
      },
      {
        id: "rq_called",
        availabilityId: "av_1",
        status: AppointmentStatus.CALLED,
        stream: VisitStream.NEW_CONSULTATION,
        tokenNumber: 1,
        queueScopeKey: "d1:2026-11-20:av_1",
        checkedInAt: createISTDate(2026, 11, 20, 9, 45),
        calledAt: createISTDate(2026, 11, 20, 10, 5),
        actualStartAt: null,
        createdAt: slotStart,
        patient: { id: "p1", phone: "8888888888", user: { name: "First Called" } },
        availability: {
          id: "av_1",
          kind: AvailabilityKind.WAVE_SLOT,
          startTime: slotStart,
          endTime: slotEnd,
          doctor: {
            id: "d1",
            specialization: "Dermatology",
            user: { name: "Dr. Meera" },
          },
        },
      },
    ],
    now,
    [],
    "2026-11-20"
  );
  assert.equal(recData.selectedDateIST, "2026-11-20");
  assert.equal(recData.doctorQueues[0]?.subSlots[0]?.canCallNext, false); // blocked while rq_called is CALLED
  assert.equal(
    recData.appointments.find((r) => r.id === "rq_called")?.canStartConsultation,
    true
  );
  assert.equal(
    recData.appointments.find((r) => r.id === "rq_called")?.canMarkCompleted,
    false
  );

  // Patient Portal DTO includes persisted tokenNumber, subSlotLabel, CALLED status & queue estimate
  const patDto = toPatientAppointmentDto(
    {
      id: "dq_called",
      status: AppointmentStatus.CALLED,
      stream: VisitStream.NEW_CONSULTATION,
      createdAt: slotStart,
      checkedInAt: createISTDate(2026, 11, 20, 9, 45),
      calledAt: createISTDate(2026, 11, 20, 10, 5),
      tokenNumber: 4,
      queueScopeKey: "d1:2026-11-20:av_1",
      rescheduleCount: 0,
      wave: {
        windowStart: slotStart,
        windowEnd: slotEnd,
        status: WaveStatus.PUBLISHED,
      },
      availability: {
        id: "av_1",
        kind: AvailabilityKind.WAVE_SLOT,
        startTime: slotStart,
        endTime: slotEnd,
        doctor: {
          id: "d1",
          specialization: "Dermatology",
          consultationFee: 500,
          user: { name: "Meera" },
        },
      },
    },
    now,
    {
      expectedStart: createISTDate(2026, 11, 20, 10, 5),
      delayMinutes: 5,
      roundedDelayMinutes: 5,
      queuePosition: 1,
    }
  );

  assert.equal(patDto.tokenNumber, 4);
  assert.equal(patDto.queueScopeKey, "d1:2026-11-20:av_1");
  assert.equal(patDto.subSlotLabel, formatSubSlotLabel({
    kind: AvailabilityKind.WAVE_SLOT,
    availabilityStart: slotStart,
    availabilityEnd: slotEnd,
  }));
  assert.equal(patDto.calledAt, createISTDate(2026, 11, 20, 10, 5).toISOString());
  assert.equal(patDto.queuePosition, 1);

  // Direct RBAC guard helper assertions across all 3 portals + Admin
  assert.equal(canStaffCheckIn({ status: AppointmentStatus.CONFIRMED }, Role.DOCTOR).allowed, false);
  assert.equal(canStaffCheckIn({ status: AppointmentStatus.CONFIRMED }, Role.ADMIN).allowed, false);
  assert.equal(canStaffCheckIn({ status: AppointmentStatus.CONFIRMED }, Role.PATIENT).allowed, false);
  assert.equal(canStaffCheckIn({ status: AppointmentStatus.CONFIRMED }, Role.RECEPTIONIST).allowed, true);
  assert.equal(canReceptionistCallNext({ status: AppointmentStatus.CHECKED_IN }, Role.RECEPTIONIST).allowed, true);
  assert.equal(canReceptionistCallNext({ status: AppointmentStatus.CHECKED_IN }, Role.DOCTOR).allowed, false);
  assert.equal(canReceptionistCallNext({ status: AppointmentStatus.CHECKED_IN }, Role.ADMIN).allowed, false);
  assert.equal(canReceptionistStartConsultation({ status: AppointmentStatus.CALLED }, Role.RECEPTIONIST).allowed, true);
  assert.equal(canReceptionistStartConsultation({ status: AppointmentStatus.CALLED }, Role.DOCTOR).allowed, false);
  assert.equal(canReceptionistStartConsultation({ status: AppointmentStatus.CALLED }, Role.ADMIN).allowed, false);
  assert.equal(canReceptionistComplete({ status: AppointmentStatus.IN_CONSULTATION }, Role.RECEPTIONIST).allowed, true);
  assert.equal(canReceptionistComplete({ status: AppointmentStatus.CALLED }, Role.RECEPTIONIST).allowed, false);
  assert.equal(canReceptionistComplete({ status: AppointmentStatus.CHECKED_IN }, Role.RECEPTIONIST).allowed, false);
  assert.equal(canReceptionistComplete({ status: AppointmentStatus.IN_CONSULTATION }, Role.DOCTOR).allowed, false);
  assert.equal(canReceptionistComplete({ status: AppointmentStatus.IN_CONSULTATION }, Role.ADMIN).allowed, false);
  assert.equal(canMarkNoShow({ status: AppointmentStatus.CALLED, startTime: slotStart }, createISTDate(2026, 11, 20, 10, 20)).allowed, true);
  assert.equal(isValidTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED, Role.RECEPTIONIST), false);
  assert.equal(canPatientCheckIn({ status: AppointmentStatus.CALLED, startTime: slotStart, endTime: slotEnd }, now).allowed, false);
  assert.equal(getQueueStatusLabel(AppointmentStatus.CALLED), "Called");
  assert.equal(getQueueStatusLabel(AppointmentStatus.NO_SHOW), "Not Arrived");

  // Helper smoke verification for notification formatting & picker
  const notif = formatDoctorCalledNotification({
    doctorName: "Dr. Kavita",
    patientName: "Rohan",
    tokenNumber: 5,
    subSlotLabel: "Sub-slot 10:30 AM",
    calledAt: createISTDate(2026, 11, 20, 10, 32),
  });
  assert.equal(notif.body.includes("Dr. Dr."), false);
  assert.equal(notif.title, "Next Patient Called by Reception");
  assert.match(notif.body, /Reception Desk called Patient Rohan – Token #5 for Dr\. Kavita \(Sub-slot 10:30 AM, 10:32 am IST\)/i);

  const picked = pickNextCallableAppointment([
    { id: "c1", status: AppointmentStatus.CONFIRMED, tokenNumber: 1 },
    { id: "c3", status: AppointmentStatus.CHECKED_IN, tokenNumber: 3 },
    { id: "c2", status: AppointmentStatus.CHECKED_IN, tokenNumber: 2 },
  ]);
  assert.equal(picked?.id, "c2");
});

test("Scenario 14-15: Static schema, forward-only migration SQL, strictly read-only Doctor Queue, Receptionist workflow, and Patient sub-slot scoping verification", () => {
  const schema = readRepoFile("prisma/schema.prisma");
  assert.match(schema, /enum AppointmentStatus[\s\S]*CALLED/);
  assert.match(schema, /enum NotificationType[\s\S]*QUEUE_CALLED/);
  assert.match(schema, /tokenCounter\s+Int\s+@default\(0\)\s+@map\("token_counter"\)/);
  assert.match(schema, /tokenNumber\s+Int\?\s+@map\("token_number"\)/);
  assert.match(schema, /queueScopeKey\s+String\?\s+@map\("queue_scope_key"\)/);
  assert.match(schema, /@@unique\(\[queueScopeKey,\s*tokenNumber\]\)/);

  const migrationSql = readRepoFile(
    "prisma/migrations/20261117220000_redesign_queue_tokens_and_roles/migration.sql"
  );
  assert.match(migrationSql, /ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CALLED'/);
  assert.match(migrationSql, /ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'QUEUE_CALLED'/);
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS "token_counter"/);
  assert.match(migrationSql, /existing_max/);
  assert.match(migrationSql, /appointments_queue_scope_key_token_number_key/);

  // Doctor Queue View must be COMPLETELY READ-ONLY: zero queue/consultation mutation actions or buttons!
  const doctorQueueView = readRepoFile("src/app/doctor/queue/doctor-queue-view.tsx");
  assert.match(doctorQueueView, /setInterval\(/);
  assert.match(doctorQueueView, /router\.refresh\(\)/);
  assert.match(doctorQueueView, /Read-only live queue monitor/);
  assert.match(doctorQueueView, /Not Arrived/);
  assert.equal(doctorQueueView.includes("callNextPatientAction"), false);
  assert.equal(doctorQueueView.includes("Call Next Patient"), false);
  assert.equal(doctorQueueView.includes("doctorMarkArrivedAction"), false);
  assert.equal(doctorQueueView.includes("doctorNoShowAction"), false);
  assert.equal(doctorQueueView.includes("startConsultationAction"), false);
  assert.equal(doctorQueueView.includes("Start Consultation"), false);
  assert.equal(doctorQueueView.includes("endConsultationAction"), false);
  assert.equal(doctorQueueView.includes("End Consultation"), false);
  assert.equal(doctorQueueView.includes("Mark Arrived"), false);
  assert.equal(doctorQueueView.includes("No Show"), false);
  assert.equal(doctorQueueView.includes("Mark Priority"), false);
  assert.equal(doctorQueueView.includes("setPriorityStreamAction"), false);

  // Receptionist View centralizes Date + Doctor + Sub-Slot selection and ALL queue/consultation actions
  const receptionistView = readRepoFile("src/app/receptionist/receptionist-dashboard-view.tsx");
  assert.match(receptionistView, /receptionistCallNextPatientAction/);
  assert.match(receptionistView, /receptionistStartConsultationAction/);
  assert.match(receptionistView, /receptionistMarkArrivedAction/);
  assert.match(receptionistView, /receptionistMarkNotArrivedAction/);
  assert.match(receptionistView, /receptionistMarkCompletedAction/);
  assert.match(receptionistView, /Call Next Patient/);
  assert.match(receptionistView, /Start Consultation/);
  assert.match(receptionistView, /selectedDateIST/);
  assert.match(receptionistView, /effectiveSubSlotFilter/);

  // Receptionist does not query or depend on receiving self-notifications, and notifications are non-misleading
  const receptionistServerSrc = readRepoFile("src/lib/receptionist-server.ts");
  assert.equal(receptionistServerSrc.includes("NotificationType.QUEUE_CALLED"), false);
  const queueActionsSrc = readRepoFile("src/lib/actions/queue.ts");
  assert.match(queueActionsSrc, /userId:\s*txResult\.patientUserId[\s\S]*Reception Desk called you/);
  assert.match(queueActionsSrc, /userId:\s*txResult\.doctorUserId[\s\S]*txResult\.notification\.body/);

  // Entire Doctor Portal & Doctor AI Assistant must expose ZERO queue/consultation completion or No-Show mutation controls
  const doctorApptsView = readRepoFile("src/app/doctor/appointments/doctor-appointments-view.tsx");
  assert.match(doctorApptsView, /targetStatus:\s*"CANCELLED"/);
  assert.equal(doctorApptsView.includes("Mark Arrived"), false);
  assert.equal(doctorApptsView.includes("Start Consultation"), false);
  assert.equal(doctorApptsView.includes("Call Next"), false);
  assert.equal(doctorApptsView.includes("Not Arrived"), false);
  assert.equal(doctorApptsView.includes("End Consultation"), false);
  assert.equal(doctorApptsView.includes("Mark Priority"), false);

  const doctorApptsActions = readRepoFile("src/lib/actions/doctor-appointments.ts");
  assert.match(doctorApptsActions, /targetStatus !== "CANCELLED"/);
  assert.equal(doctorApptsActions.includes("status: AppointmentStatus.NO_SHOW"), false);
  assert.equal(doctorApptsActions.includes("status: AppointmentStatus.COMPLETED"), false);

  const doctorToolsSrc = readRepoFile("src/lib/ai/tools/doctor-tools.ts");
  assert.equal(doctorToolsSrc.includes("DOCTOR_COMPLETE_APPOINTMENT"), false);
  assert.equal(doctorToolsSrc.includes("DOCTOR_MARK_NO_SHOW"), false);
  assert.match(doctorToolsSrc, /canDoctorComplete:\s*false/);
  assert.match(doctorToolsSrc, /canDoctorNoShow:\s*false/);

  const aiConfirmSrc = readRepoFile("src/lib/ai/confirmation.ts");
  assert.match(aiConfirmSrc, /DOCTOR_COMPLETE_APPOINTMENT[\s\S]*DOCTOR_MARK_NO_SHOW[\s\S]*Reception Desk/);

  const serializersSrc = readRepoFile("src/lib/serializers.ts");
  assert.match(serializersSrc, /canMarkArrived\s*=\s*false/);
  assert.match(serializersSrc, /canStartConsultation\s*=\s*false/);
  assert.match(serializersSrc, /canEndConsultation\s*=\s*false/);
  assert.match(serializersSrc, /canNoShow:\s*false/);

  // Reschedule & payment finalization guards
  const rescheduleSrc = readRepoFile("src/lib/actions/reschedule.ts");
  assert.match(
    rescheduleSrc,
    /export async function doctorRescheduleAppointmentAction[\s\S]*status:\s*\{\s*in:\s*\[AppointmentStatus\.PENDING,\s*AppointmentStatus\.CONFIRMED\]\s*\}/
  );

  const paymentServiceSrc = readRepoFile("src/lib/payments/service.ts");
  assert.match(
    paymentServiceSrc,
    /export async function finalizeConfirmedAppointment[\s\S]*revalidatePath\("\/receptionist"\)/
  );

  // Patient pages strictly query by today's availabilityId(s) using calculateSubSlotQueues without loading other patients' PII
  const patientAppointmentsPage = readRepoFile("src/app/patient/appointments/page.tsx");
  assert.match(patientAppointmentsPage, /availabilityId:\s*\{\s*in:/);
  assert.match(patientAppointmentsPage, /calculateSubSlotQueues/);
  assert.equal(patientAppointmentsPage.includes("patient: {"), false);

  const patientDashboardPage = readRepoFile("src/app/patient/dashboard/page.tsx");
  assert.match(patientDashboardPage, /LiveQueueRefresh/);
});
