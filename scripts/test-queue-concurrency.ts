/**
 * Concurrency test for live queue and scheduling race conditions.
 * Tests:
 * 1. Concurrent startConsultationAction for the same doctor across two different checked-in appointments:
 *    Exactly ONE succeeds, ONE fails with "already in consultation".
 * 2. Concurrent reschedule into the same target slot:
 *    Exactly ONE succeeds, ONE fails with slot already taken; old slot is freed ONLY for the winner.
 *
 * Run with: npx tsx scripts/test-queue-concurrency.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import {
  Role,
  DoctorStatus,
  SlotStatus,
  AppointmentStatus,
  VisitStream,
} from "../src/generated/prisma/client";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

async function runConcurrencyTests() {
  console.log("=== Medrella Live Queue & Scheduling Concurrency Tests ===");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    console.log("⚠️ DATABASE_URL is not configured in the active environment.");
    console.log("Skipping live database concurrency test (marked UNTESTED in zero-credential environment).");
    process.exit(0);
  }

  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  const createdUserIds: string[] = [];
  const createdSlotIds: string[] = [];
  const createdAppointmentIds: string[] = [];

  try {
    console.log("Connecting to database...");

    // -------------------------------------------------------------
    // Test 1: Concurrent startConsultation for the same doctor
    // -------------------------------------------------------------
    console.log("\n--- Test 1: Concurrent startConsultation Race Condition ---");

    const doctorUser = await db.user.create({
      data: {
        name: `Dr. RaceTest ${Date.now()}`,
        email: `dr.racetest.${Date.now()}@medrella.internal`,
        role: Role.DOCTOR,
        doctor: {
          create: {
            specialization: "General Medicine",
            consultationFee: 400,
            status: DoctorStatus.APPROVED,
          },
        },
      },
      include: { doctor: true },
    });
    createdUserIds.push(doctorUser.id);
    const doctor = doctorUser.doctor!;

    const [pUser1, pUser2] = await Promise.all([
      db.user.create({
        data: {
          name: "Patient Race 1",
          email: `race.p1.${Date.now()}@medrella.internal`,
          role: Role.PATIENT,
          patient: { create: { gender: "Female", phone: "9000000001" } },
        },
        include: { patient: true },
      }),
      db.user.create({
        data: {
          name: "Patient Race 2",
          email: `race.p2.${Date.now()}@medrella.internal`,
          role: Role.PATIENT,
          patient: { create: { gender: "Male", phone: "9000000002" } },
        },
        include: { patient: true },
      }),
    ]);
    createdUserIds.push(pUser1.id, pUser2.id);

    const now = Date.now();
    const slot1 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: new Date(now - 30 * 60 * 1000),
        endTime: new Date(now),
        status: SlotStatus.BOOKED,
      },
    });
    const slot2 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: new Date(now),
        endTime: new Date(now + 30 * 60 * 1000),
        status: SlotStatus.BOOKED,
      },
    });
    createdSlotIds.push(slot1.id, slot2.id);

    // Create two CHECKED_IN appointments for the same doctor
    const [appt1, appt2] = await Promise.all([
      db.appointment.create({
        data: {
          patientId: pUser1.patient!.id,
          availabilityId: slot1.id,
          status: AppointmentStatus.CHECKED_IN,
          stream: VisitStream.NEW_CONSULTATION,
          checkedInAt: new Date(),
        },
      }),
      db.appointment.create({
        data: {
          patientId: pUser2.patient!.id,
          availabilityId: slot2.id,
          status: AppointmentStatus.CHECKED_IN,
          stream: VisitStream.FOLLOW_UP,
          checkedInAt: new Date(),
        },
      }),
    ]);
    createdAppointmentIds.push(appt1.id, appt2.id);

    console.log(`Created 2 checked-in appointments (${appt1.id}, ${appt2.id}) for Dr. ${doctorUser.name}.`);
    console.log("Simulating simultaneous startConsultation requests with doctor row locking...");

    // Isolated worker function replicating startConsultationAction's transaction
    async function executeStartConsultation(appointmentId: string, doctorId: string) {
      return db.$transaction(
        async (tx) => {
          // 1. Lock doctor row
          await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctorId} FOR UPDATE`;

          // 2. Check if doctor already has an active consultation
          const activeConsultation = await tx.appointment.findFirst({
            where: {
              availability: { doctorId },
              status: AppointmentStatus.IN_CONSULTATION,
            },
          });

          if (activeConsultation) {
            throw new Error("DOCTOR_ALREADY_IN_CONSULTATION");
          }

          // 3. Conditional update WHERE status = CHECKED_IN
          const updated = await tx.appointment.updateMany({
            where: {
              id: appointmentId,
              status: AppointmentStatus.CHECKED_IN,
            },
            data: {
              status: AppointmentStatus.IN_CONSULTATION,
              actualStartAt: new Date(),
            },
          });

          if (updated.count !== 1) {
            throw new Error("APPOINTMENT_NOT_CHECKED_IN");
          }

          return { success: true, appointmentId };
        },
        { maxWait: 10000, timeout: 20000 }
      );
    }

    const startResults = await Promise.allSettled([
      executeStartConsultation(appt1.id, doctor.id),
      executeStartConsultation(appt2.id, doctor.id),
    ]);

    const startSuccesses = startResults.filter((r) => r.status === "fulfilled");
    const startFailures = startResults.filter((r) => r.status === "rejected");

    console.log(`StartConsultation results: ${startSuccesses.length} succeeded, ${startFailures.length} failed.`);

    if (startSuccesses.length !== 1 || startFailures.length !== 1) {
      throw new Error(
        `Assertion failed: Expected exactly 1 success and 1 failure, but got ${startSuccesses.length} success and ${startFailures.length} failures.`
      );
    }

    const failureReason = (startFailures[0] as PromiseRejectedResult).reason?.message;
    console.log("Failure error message:", failureReason);
    if (!failureReason?.includes("DOCTOR_ALREADY_IN_CONSULTATION")) {
      throw new Error(`Expected error DOCTOR_ALREADY_IN_CONSULTATION, received: ${failureReason}`);
    }

    console.log("✓ Test 1 Passed: Exactly ONE consultation started, race condition prevented by row lock.");

    // -------------------------------------------------------------
    // Test 2: Concurrent Reschedule into Same Target Slot
    // -------------------------------------------------------------
    console.log("\n--- Test 2: Concurrent Reschedule into Same Target Slot ---");

    const slotOld1 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: new Date(now + 4 * 60 * 60 * 1000),
        endTime: new Date(now + 4.5 * 60 * 60 * 1000),
        status: SlotStatus.BOOKED,
      },
    });
    const slotOld2 = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: new Date(now + 5 * 60 * 60 * 1000),
        endTime: new Date(now + 5.5 * 60 * 60 * 1000),
        status: SlotStatus.BOOKED,
      },
    });
    const targetSlot = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime: new Date(now + 6 * 60 * 60 * 1000),
        endTime: new Date(now + 6.5 * 60 * 60 * 1000),
        status: SlotStatus.AVAILABLE,
      },
    });
    createdSlotIds.push(slotOld1.id, slotOld2.id, targetSlot.id);

    const [reschedAppt1, reschedAppt2] = await Promise.all([
      db.appointment.create({
        data: {
          patientId: pUser1.patient!.id,
          availabilityId: slotOld1.id,
          status: AppointmentStatus.CONFIRMED,
          stream: VisitStream.NEW_CONSULTATION,
        },
      }),
      db.appointment.create({
        data: {
          patientId: pUser2.patient!.id,
          availabilityId: slotOld2.id,
          status: AppointmentStatus.CONFIRMED,
          stream: VisitStream.FOLLOW_UP,
        },
      }),
    ]);
    createdAppointmentIds.push(reschedAppt1.id, reschedAppt2.id);

    console.log(`Created 2 confirmed appointments attempting to reschedule to target slot ${targetSlot.id}.`);

    // Worker function replicating patientRescheduleAppointmentAction transaction
    async function executeReschedule(appointmentId: string, oldSlotId: string, targetSlotId: string) {
      return db.$transaction(
        async (tx) => {
          // 1. Atomically claim target slot
          const targetUpdated = await tx.availability.updateMany({
            where: {
              id: targetSlotId,
              status: SlotStatus.AVAILABLE,
            },
            data: { status: SlotStatus.BOOKED },
          });

          if (targetUpdated.count !== 1) {
            throw new Error("TARGET_SLOT_UNAVAILABLE");
          }

          // 2. Release old slot to AVAILABLE
          await tx.availability.update({
            where: { id: oldSlotId },
            data: {
              status: SlotStatus.AVAILABLE,
              blockedByTimeOffId: null,
            },
          });

          // 3. Update appointment (stays CONFIRMED on reschedule)
          const updatedAppt = await tx.appointment.update({
            where: { id: appointmentId },
            data: {
              availabilityId: targetSlotId,
              status: AppointmentStatus.CONFIRMED,
              rescheduleCount: { increment: 1 },
            },
          });

          return updatedAppt;
        },
        { maxWait: 10000, timeout: 20000 }
      );
    }

    const reschedResults = await Promise.allSettled([
      executeReschedule(reschedAppt1.id, slotOld1.id, targetSlot.id),
      executeReschedule(reschedAppt2.id, slotOld2.id, targetSlot.id),
    ]);

    const reschedSuccesses = reschedResults.filter((r) => r.status === "fulfilled");
    const reschedFailures = reschedResults.filter((r) => r.status === "rejected");

    console.log(`Reschedule results: ${reschedSuccesses.length} succeeded, ${reschedFailures.length} failed.`);

    if (reschedSuccesses.length !== 1 || reschedFailures.length !== 1) {
      throw new Error(
        `Assertion failed: Expected exactly 1 reschedule to succeed and 1 to fail, got ${reschedSuccesses.length} success and ${reschedFailures.length} failures.`
      );
    }

    const reschedFailureReason = (reschedFailures[0] as PromiseRejectedResult).reason?.message;
    console.log("Reschedule failure error message:", reschedFailureReason);
    if (!reschedFailureReason?.includes("TARGET_SLOT_UNAVAILABLE")) {
      throw new Error(`Expected error TARGET_SLOT_UNAVAILABLE, received: ${reschedFailureReason}`);
    }

    // Verify slots in database
    const winnerAppt = (reschedSuccesses[0] as PromiseFulfilledResult<{ id: string }>).value;
    const isWinner1 = winnerAppt.id === reschedAppt1.id;

    const [dbSlotOld1, dbSlotOld2, dbTargetSlot] = await Promise.all([
      db.availability.findUnique({ where: { id: slotOld1.id } }),
      db.availability.findUnique({ where: { id: slotOld2.id } }),
      db.availability.findUnique({ where: { id: targetSlot.id } }),
    ]);

    if (isWinner1) {
      if (dbSlotOld1?.status !== SlotStatus.AVAILABLE) {
        throw new Error("Winner old slot 1 should be released to AVAILABLE.");
      }
      if (dbSlotOld2?.status !== SlotStatus.BOOKED) {
        throw new Error("Loser old slot 2 should remain BOOKED.");
      }
    } else {
      if (dbSlotOld2?.status !== SlotStatus.AVAILABLE) {
        throw new Error("Winner old slot 2 should be released to AVAILABLE.");
      }
      if (dbSlotOld1?.status !== SlotStatus.BOOKED) {
        throw new Error("Loser old slot 1 should remain BOOKED.");
      }
    }

    if (dbTargetSlot?.status !== SlotStatus.BOOKED) {
      throw new Error("Target slot should be BOOKED.");
    }

    console.log("✓ Test 2 Passed: Exactly ONE patient won target slot, loser's slot was preserved, winner's old slot was freed.");

    console.log("\nAll concurrency tests passed successfully! 🎉");
  } finally {
    console.log("\nCleaning up test records...");
    try {
      if (createdAppointmentIds.length > 0) {
        await db.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
      }
      if (createdSlotIds.length > 0) {
        await db.availability.deleteMany({ where: { id: { in: createdSlotIds } } });
      }
      if (createdUserIds.length > 0) {
        await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      console.log("Cleanup complete.");
    } catch (cleanupErr) {
      console.warn("Notice: Test cleanup encountered an issue:", cleanupErr);
    }
    await db.$disconnect();
  }
}

runConcurrencyTests().catch((err) => {
  console.error("Concurrency test failed:", err);
  process.exit(1);
});
