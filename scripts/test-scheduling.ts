/**
 * UNTESTED live-database scheduling verification.
 *
 * This script intentionally reads only an already-exported DATABASE_URL. It does
 * not load .env files. Run only when DATABASE_URL points to a disposable test
 * database; every TEST- prefixed row is removed in finally.
 */
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaClient, AvailabilityKind, AppointmentStatus, Role, SlotStatus } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { generatedScheduleDates, planScheduleDates } from "../src/lib/scheduling";

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("UNTESTED: DATABASE_URL is not set; no live scheduling checks were run.");
  process.exit(0);
}

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: databaseUrl }) });
const marker = `TEST-${Date.now()}`;
const ids = { user: [] as string[], availability: [] as string[], appointment: [] as string[] };

async function main() {
  const recurringInput = {
    type: "WAVE" as const,
    recurrence: "RECURRING" as const,
    startDate: "2026-11-09",
    endDate: "2026-11-11",
    daysOfWeek: [1, 3],
    startMinute: 600,
    endMinute: 720,
    durationMinutes: 30,
    capacity: 3,
  };
  const recurringDates = generatedScheduleDates(recurringInput, "2026-11-01");
  const overridePlan = planScheduleDates(
    { ...recurringInput, recurrence: "ONCE", endDate: "2026-11-09", daysOfWeek: [] },
    ["2026-11-09"],
    { "2026-11-09": ["TEST-recurring-schedule"] },
    {},
  );
  if (recurringDates.length !== 2 || overridePlan[0]?.overrideRecurringScheduleId !== "TEST-recurring-schedule") {
    throw new Error("Override planning did not replace only the requested recurring date.");
  }
  console.log("UNTESTED override planning prepared: recurring Monday/Wednesday schedule overrides Monday only.");

  const doctorUser = await db.user.create({
    data: {
      name: `${marker} Doctor`,
      email: `${marker.toLowerCase()}-doctor@example.invalid`,
      role: Role.DOCTOR,
      doctor: { create: { specialization: "Test", status: "APPROVED" } },
    },
    include: { doctor: true },
  });
  ids.user.push(doctorUser.id);
  const patients = await Promise.all([1, 2, 3, 4, 5, 6].map((index) => db.user.create({
    data: {
      name: `${marker} Patient ${index}`,
      email: `${marker.toLowerCase()}-patient-${index}@example.invalid`,
      role: Role.PATIENT,
      patient: { create: {} },
    },
    include: { patient: true },
  })));
  ids.user.push(...patients.map((patient) => patient.id));

  const start = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const slot = await db.availability.create({
    data: { doctorId: doctorUser.doctor!.id, startTime: start, endTime: end, kind: AvailabilityKind.WAVE_SLOT, capacity: 3, status: SlotStatus.AVAILABLE },
  });
  ids.availability.push(slot.id);
  const results = await Promise.allSettled(patients.map((patient) => db.$transaction(async (tx) => {
    const claimed = await tx.$executeRaw`
      UPDATE "availabilities"
      SET "active_count" = "active_count" + 1,
          "status" = CASE WHEN "active_count" + 1 >= "capacity" THEN 'BOOKED'::"SlotStatus" ELSE "status" END
      WHERE "id" = ${slot.id} AND "active_count" < "capacity" AND "status" <> 'BLOCKED'::"SlotStatus"
    `;
    if (claimed !== 1) throw new Error("SLOT_FULL");
    const appointment = await tx.appointment.create({ data: { patientId: patient.patient!.id, availabilityId: slot.id, status: AppointmentStatus.CONFIRMED } });
    return appointment.id;
  })));
  const successes = results.filter((result) => result.status === "fulfilled");
  if (successes.length !== 3) throw new Error(`Expected 3 wave bookings, got ${successes.length}.`);
  ids.appointment.push(...successes.map((result) => (result as PromiseFulfilledResult<string>).value));
  console.log("UNTESTED live checks prepared: capacity-3 wave accepted exactly three concurrent seats.");
}

main()
  .catch((error) => {
    console.error("UNTESTED scheduling script failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.appointment.deleteMany({ where: { id: { in: ids.appointment } } });
    await db.availability.deleteMany({ where: { id: { in: ids.availability } } });
    await db.user.deleteMany({ where: { id: { in: ids.user } } });
    await db.$disconnect();
  });
