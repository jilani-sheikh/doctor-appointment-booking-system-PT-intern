import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { getPaymentProvider } from "../src/lib/payments/factory";
import { handlePaymentSuccess } from "../src/lib/payments/service";

neonConfig.webSocketConstructor = ws;

async function checkOrder() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error("Usage: npx tsx -r ./scripts/shim-server-only.js scripts/check-order.ts <orderId>");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is missing.");
    process.exit(1);
  }

  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  try {
    console.log(`Checking order: ${orderId}...`);
    const payment = await db.payment.findUnique({
      where: { providerOrderId: orderId },
      include: {
        appointment: {
          include: {
            availability: true,
            patient: true,
          },
        },
        refunds: true,
      },
    });

    if (!payment) {
      console.log(`Payment record NOT FOUND in database for providerOrderId: ${orderId}`);
    } else {
      console.log("--- Payment Details ---");
      console.log(`Payment ID: ${payment.id}`);
      console.log(`Payment Status: ${payment.status}`);
      console.log(`Amount: ₹${payment.amount}`);
      console.log(`Needs Attention: ${payment.needsAttention} (${payment.attentionReason || "none"})`);
      console.log(`Created At: ${payment.createdAt.toISOString()}`);
      console.log(`Paid At: ${payment.paidAt ? payment.paidAt.toISOString() : "null"}`);

      console.log("\n--- Appointment Details ---");
      console.log(`Appointment ID: ${payment.appointment.id}`);
      console.log(`Appointment Status: ${payment.appointment.status}`);
      console.log(`Hold Expires At: ${payment.appointment.holdExpiresAt ? payment.appointment.holdExpiresAt.toISOString() : "null"}`);
      console.log(`Slot Status: ${payment.appointment.availability.status}`);
      console.log(`Slot Start: ${payment.appointment.availability.startTime.toISOString()}`);

      // Count notification_deliveries rows by status for this appointment
      const deliveryGroups = await db.notificationDelivery.groupBy({
        by: ["status"],
        where: { appointmentId: payment.appointment.id },
        _count: { status: true },
      });

      console.log("\n--- Notification Deliveries Count ---");
      if (deliveryGroups.length === 0) {
        console.log("No notification deliveries recorded for this appointment.");
      } else {
        for (const g of deliveryGroups) {
          console.log(`Status ${g.status}: ${g._count.status}`);
        }
      }
    }

    // Now check true gateway status via Cashfree provider
    console.log("\n--- Gateway Query ---");
    try {
      const provider = getPaymentProvider();
      const gatewayOrder = await provider.getOrder(orderId);
      console.log(`Gateway Order Status: ${gatewayOrder.orderStatus}`);
      console.log(`Gateway Order Amount: ₹${gatewayOrder.orderAmount}`);
      console.log(`Gateway CF Order ID: ${gatewayOrder.cfOrderId || "none"}`);

      if (gatewayOrder.orderStatus === "PAID") {
        if (payment && payment.status !== "PAID") {
          console.log("\n[Reconciliation] Order is PAID at gateway but not marked PAID in database. Reconciling now...");
          const reconResult = await handlePaymentSuccess(orderId);
          console.log(`Reconciliation result: success=${reconResult}`);
          
          const updatedApt = await db.appointment.findUnique({
            where: { id: payment.appointmentId },
            include: { availability: true },
          });
          console.log(`Updated Appointment Status: ${updatedApt?.status}`);
          console.log(`Updated Slot Status: ${updatedApt?.availability.status}`);
        } else {
          console.log("Order is already reconciled and PAID in database.");
        }
      }
    } catch (gwErr) {
      console.error("Gateway lookup error:", gwErr instanceof Error ? gwErr.message : gwErr);
    }

  } finally {
    await db.$disconnect();
  }
}

checkOrder().catch((e) => {
  console.error(e);
  process.exit(1);
});
