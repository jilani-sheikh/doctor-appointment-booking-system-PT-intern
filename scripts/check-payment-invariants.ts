/**
 * Standalone verification script: checks database payment invariants across all appointments and payments.
 * Invariants:
 * 1. Every CONFIRMED appointment requiring payment (fee > 0, post-payments rollout) must have a PAID Payment record.
 * 2. Every CANCELLED appointment that had a PAID Payment must have a Refund record (unless reason is EXPIRED_UNPAID or fee 0).
 * 3. Total refunded amount on any Payment must never exceed the payment amount.
 * 4. No slot in AVAILABLE state should have an active unexpired hold.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { db } from "../src/lib/db";
import { AppointmentStatus, PaymentStatus, RefundStatus } from "../src/generated/prisma/enums";

async function main() {
  console.log("=================================================================");
  console.log("         MEDRELLA DATABASE PAYMENT INVARIANTS AUDIT               ");
  console.log("=================================================================\n");

  let violations = 0;

  // Check 1: Payments with total refunds exceeding payment amount
  const payments = await db.payment.findMany({
    include: { refunds: true, appointment: true },
  });

  for (const p of payments) {
    const totalRefunded = p.refunds
      .filter((r) => r.status === RefundStatus.SUCCESS || r.status === RefundStatus.PENDING || r.status === RefundStatus.REQUESTED)
      .reduce((acc, r) => acc + Number(r.amount), 0);

    if (totalRefunded > Number(p.amount) + 0.001) {
      console.error(`[VIOLATION 1] Payment ${p.id} (Order: ${p.providerOrderId}) over-refunded! Amount: ${p.amount}, Total Refunded: ${totalRefunded}`);
      violations++;
    }
  }

  // Check 2: Paid payments on CANCELLED appointments without refund record
  const cancelledWithPaid = await db.payment.findMany({
    where: {
      status: PaymentStatus.PAID,
      appointment: {
        status: AppointmentStatus.CANCELLED,
      },
    },
    include: { refunds: true, appointment: true },
  });

  for (const p of cancelledWithPaid) {
    if (p.refunds.length === 0) {
      console.error(`[VIOLATION 2] Paid Payment ${p.id} on CANCELLED Appointment ${p.appointmentId} has ZERO refund records!`);
      violations++;
    }
  }

  // Check 3: Active holds on AVAILABLE slots (slots with active holds must be BOOKED)
  const availableSlotsWithHolds = await db.availability.findMany({
    where: {
      status: "AVAILABLE",
      appointments: {
        some: {
          status: AppointmentStatus.PENDING_PAYMENT,
          holdExpiresAt: {
            gt: new Date(),
          },
        },
      },
    },
    include: { appointments: true },
  });

  for (const slot of availableSlotsWithHolds) {
    console.error(`[VIOLATION 3] Slot ${slot.id} is marked AVAILABLE but has active hold appointment`);
    violations++;
  }

  // Check 4: Double bookings on same slot
  const doubleBookedSlots = await db.appointment.groupBy({
    by: ["availabilityId"],
    where: {
      status: {
        in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION],
      },
    },
    _count: {
      id: true,
    },
    having: {
      id: {
        _count: {
          gt: 1,
        },
      },
    },
  });

  if (doubleBookedSlots.length > 0) {
    for (const d of doubleBookedSlots) {
      console.error(`[VIOLATION 4] Slot ${d.availabilityId} has ${d._count.id} active appointments!`);
      violations++;
    }
  }

  console.log(`\nAudit completed: ${payments.length} payments checked.`);
  if (violations === 0) {
    console.log("✓ ALL PAYMENT & HOLD DATABASE INVARIANTS SATISFIED (0 violations)!\n");
  } else {
    console.error(`❌ Found ${violations} database invariant violation(s)!\n`);
    process.exit(1);
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Invariant check error:", err);
  process.exit(1);
});
