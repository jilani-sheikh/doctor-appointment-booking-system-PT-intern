/**
 * Data migration script to auto-confirm legacy PENDING appointments with future slots.
 *
 * Rules:
 * - Standalone script with its own PrismaClient (Neon adapter + ws) and dotenv.
 * - Dry-run by default; pass --apply to execute updates and dispatch notifications.
 * - Confirms only appointments with slots in the future (startTime > now).
 * - Dispatches APPOINTMENT_CONFIRMED in-app notification to the patient.
 *
 * Usage:
 *   npx tsx scripts/confirm-legacy-pending.ts          # Dry-run inspection
 *   npx tsx scripts/confirm-legacy-pending.ts --apply  # Live migration
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaClient, AppointmentStatus, NotificationType } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

function formatDateTimeIST(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

async function runLegacyPendingConfirmation() {
  const isApply = process.argv.includes("--apply");
  console.log(`=== Legacy PENDING Appointment Auto-Confirmation [Mode: ${isApply ? "APPLY" : "DRY RUN"}] ===\n`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    console.log("⚠️ DATABASE_URL is not configured in the active environment.");
    console.log("Skipping legacy confirmation script (marked UNTESTED in zero-credential environment).");
    process.exit(0);
  }

  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  try {
    const now = new Date();

    // 1. Query future PENDING appointments
    const futurePendingAppointments = await db.appointment.findMany({
      where: {
        status: AppointmentStatus.PENDING,
        availability: {
          startTime: { gt: now },
        },
      },
      include: {
        availability: {
          include: {
            doctor: {
              include: {
                user: { select: { name: true } },
              },
            },
          },
        },
        patient: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: {
        availability: { startTime: "asc" },
      },
    });

    // 2. Query past PENDING appointments for diagnostic awareness
    const pastPendingCount = await db.appointment.count({
      where: {
        status: AppointmentStatus.PENDING,
        availability: {
          startTime: { lte: now },
        },
      },
    });

    console.log(`Found ${futurePendingAppointments.length} future PENDING appointment(s) eligible for auto-confirmation.`);
    console.log(`Found ${pastPendingCount} past PENDING appointment(s) (untouched by this script).\n`);

    if (futurePendingAppointments.length === 0) {
      console.log("✓ No legacy future PENDING appointments found. System is clean!");
      return;
    }

    console.log("Eligible appointments:");
    for (const appt of futurePendingAppointments) {
      const slotTimeIST = formatDateTimeIST(appt.availability.startTime);
      const doctorName = appt.availability.doctor.user.name ?? "Practitioner";
      const patientName = appt.patient.user.name ?? "Patient";
      console.log(`  - ID: ${appt.id} | Patient: ${patientName} | Dr: ${doctorName} | Slot: ${slotTimeIST}`);
    }

    if (!isApply) {
      console.log("\n[DRY RUN] No database records were modified.");
      console.log("To confirm these appointments and notify patients, rerun with: npx tsx scripts/confirm-legacy-pending.ts --apply");
      return;
    }

    // Apply updates and send notifications
    console.log("\nApplying updates to database...");
    let updatedCount = 0;

    for (const appt of futurePendingAppointments) {
      const slotTimeIST = formatDateTimeIST(appt.availability.startTime);
      const doctorName = appt.availability.doctor.user.name ?? "Practitioner";

      // Update status to CONFIRMED
      await db.appointment.update({
        where: { id: appt.id },
        data: {
          status: AppointmentStatus.CONFIRMED,
        },
      });

      // Dispatch patient notification
      await db.notification.create({
        data: {
          userId: appt.patient.userId,
          type: NotificationType.APPOINTMENT_CONFIRMED,
          title: "Your appointment is booked",
          body: `Your consultation with Dr. ${doctorName} on ${slotTimeIST} has been confirmed.`,
          href: "/patient/appointments",
        },
      });

      updatedCount++;
      console.log(`  ✓ Confirmed appointment ${appt.id} and notified patient ${appt.patient.userId}`);
    }

    console.log(`\n✅ Successfully confirmed ${updatedCount} legacy PENDING appointment(s).`);
  } catch (error) {
    console.error("❌ Error executing legacy pending confirmation:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

runLegacyPendingConfirmation();
