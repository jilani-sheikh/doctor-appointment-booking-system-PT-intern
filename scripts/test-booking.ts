/**
 * Test script for concurrent booking double-booking guarantee.
 * Executes two simultaneous booking requests for the exact same consultation slot.
 * Asserts: Exactly ONE succeeds and ONE fails.
 * Run with: npx tsx scripts/test-booking.ts
 */

import { Role, DoctorStatus, SlotStatus, AppointmentStatus } from "../src/generated/prisma/client";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

async function runConcurrentBookingTest() {
  console.log("=== Medrella Concurrent Booking Verification ===");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    console.log("⚠️ DATABASE_URL is not configured in the active environment.");
    console.log("Skipping live database concurrency test (marked UNTESTED in zero-credential environment).");
    process.exit(0);
  }

  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  console.log("Connecting to database and verifying active partial unique index...");

  try {
    // 1. Verify partial unique index exists
    const indexes = (await db.$queryRaw`
      SELECT indexname::text AS indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'appointments' AND indexname = 'appointments_availability_id_active_unique';
    `) as Array<{ indexname: string; indexdef: string }>;

    if (!indexes || indexes.length === 0) {
      console.warn("⚠️ Warning: Partial unique index appointments_availability_id_active_unique not found in pg_indexes.");
    } else {
      console.log("✓ Verified partial unique index exists in PostgreSQL:", indexes[0].indexdef);
    }

    // 2. Setup or find an approved doctor with an available slot
    let doctor = await db.doctor.findFirst({
      where: { status: DoctorStatus.APPROVED },
      include: { user: true },
    });

    if (!doctor) {
      console.log("Creating temporary approved doctor for test...");
      const doctorUser = await db.user.create({
        data: {
          name: "Dr. Concurrent Test",
          email: `test.doc.${Date.now()}@medrella.internal`,
          role: Role.DOCTOR,
          doctor: {
            create: {
              specialization: "General Medicine",
              consultationFee: 500,
              status: DoctorStatus.APPROVED,
            },
          },
        },
        include: { doctor: { include: { user: true } } },
      });
      doctor = doctorUser.doctor;
    }

    if (!doctor) {
      throw new Error("Could not find or create a test doctor.");
    }

    // Create two test patients
    const [patientUser1, patientUser2] = await Promise.all([
      db.user.create({
        data: {
          name: "Patient Concurrency 1",
          email: `patient1.${Date.now()}@medrella.internal`,
          role: Role.PATIENT,
          patient: { create: { gender: "Female", phone: "9876543210" } },
        },
        include: { patient: true },
      }),
      db.user.create({
        data: {
          name: "Patient Concurrency 2",
          email: `patient2.${Date.now()}@medrella.internal`,
          role: Role.PATIENT,
          patient: { create: { gender: "Male", phone: "9876543211" } },
        },
        include: { patient: true },
      }),
    ]);

    // Create a slot starting 3 hours in the future
    const startTime = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    const slot = await db.availability.create({
      data: {
        doctorId: doctor.id,
        startTime,
        endTime,
        status: SlotStatus.AVAILABLE,
      },
    });

    console.log(`Created test slot ${slot.id} for Dr. ${doctor.user.name}.`);
    console.log("Firing two simultaneous bookings for the EXACT same slot...");

    // Concurrency test helper replicating transaction logic
    async function bookSlot(patientId: string, slotId: string) {
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      return db.$transaction(
        async (tx) => {
        const updated = await tx.availability.updateMany({
          where: {
            id: slotId,
            status: SlotStatus.AVAILABLE,
            startTime: { gt: oneHourFromNow },
          },
          data: { status: SlotStatus.BOOKED },
        });

        if (updated.count !== 1) {
          throw new Error("SLOT_UNAVAILABLE");
        }

        return tx.appointment.create({
          data: {
            patientId,
            availabilityId: slotId,
            reason: "Concurrency test verification",
            status: AppointmentStatus.PENDING,
          },
        });
        },
        { maxWait: 10000, timeout: 20000 }
      );
    }

    // Fire both concurrently
    const [result1, result2] = await Promise.allSettled([
      bookSlot(patientUser1.patient!.id, slot.id),
      bookSlot(patientUser2.patient!.id, slot.id),
    ]);

    const successes = [result1, result2].filter((r) => r.status === "fulfilled");
    const failures = [result1, result2].filter((r) => r.status === "rejected");

    console.log(`Results: ${successes.length} succeeded, ${failures.length} rejected.`);

    if (successes.length === 1 && failures.length === 1) {
      console.log("✅ Assertion PASSED: Exactly 1 concurrent booking succeeded and 1 was prevented.");
    } else {
      console.error(
        `❌ Assertion FAILED: Expected exactly 1 success and 1 failure, but got ${successes.length} and ${failures.length}.`
      );
      process.exit(1);
    }

    // Clean up test records
    await db.appointment.deleteMany({ where: { availabilityId: slot.id } });
    await db.availability.delete({ where: { id: slot.id } });
    await db.patient.deleteMany({ where: { id: { in: [patientUser1.patient!.id, patientUser2.patient!.id] } } });
    await db.user.deleteMany({ where: { id: { in: [patientUser1.id, patientUser2.id] } } });

    console.log("✓ Cleaned up test data.");
    console.log("=== All Concurrency Assertions Verified Successfully ===");
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

runConcurrentBookingTest();
