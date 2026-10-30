import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AppointmentStatus, DeliveryStatus } from "../src/generated/prisma/enums";
import { syncAppointmentReminders } from "../src/lib/notifications/reminders";

interface MockDelivery {
  id?: string;
  appointmentId?: string;
  dedupeKey?: string;
  template?: string;
  status: DeliveryStatus;
  [key: string]: unknown;
}

describe("Appointment Reminder Synchronization & Lifecycle", () => {
  const baseNow = new Date("2026-11-01T10:00:00Z");
  // Slot in 48 hours
  const slotStartTime = new Date(baseNow.getTime() + 48 * 60 * 60 * 1000);

  it("schedules reminder rows for upcoming offsets when appointment is confirmed", async () => {
    const mockDeliveries: MockDelivery[] = [];

    const mockTx = {
      notificationDelivery: {
        updateMany: async (args: { where: { appointmentId: string; status: DeliveryStatus }; data: { status: DeliveryStatus } }) => {
          let count = 0;
          for (const d of mockDeliveries) {
            if (d.appointmentId === args.where.appointmentId && d.status === args.where.status) {
              d.status = args.data.status;
              count++;
            }
          }
          return { count };
        },
        upsert: async (args: { where: { dedupeKey: string }; update: Partial<MockDelivery>; create: MockDelivery }) => {
          const idx = mockDeliveries.findIndex((d) => d.dedupeKey === args.where.dedupeKey);
          if (idx >= 0) {
            Object.assign(mockDeliveries[idx], args.update);
            return mockDeliveries[idx];
          } else {
            mockDeliveries.push({ ...args.create });
            return args.create;
          }
        },
      },
    };

    const res = await syncAppointmentReminders(mockTx as unknown as Parameters<typeof syncAppointmentReminders>[0], {
      appointmentId: "appt_123",
      userId: "user_456",
      slotStartTime,
      status: AppointmentStatus.CONFIRMED,
      now: baseNow,
    });

    assert.equal(res.scheduled, 2); // 1440m and 120m offsets are both in future
    assert.equal(mockDeliveries.length, 2);
    assert.equal(mockDeliveries[0].status, DeliveryStatus.PENDING);
    assert.equal(mockDeliveries[1].status, DeliveryStatus.PENDING);
  });

  it("marks pending reminders CANCELLED when appointment is cancelled", async () => {
    const mockDeliveries: MockDelivery[] = [
      {
        id: "del_1",
        appointmentId: "appt_123",
        template: "reminder",
        status: DeliveryStatus.PENDING,
      },
    ];

    const mockTx = {
      notificationDelivery: {
        updateMany: async (args: { where: { appointmentId: string; status: DeliveryStatus }; data: { status: DeliveryStatus } }) => {
          let count = 0;
          for (const d of mockDeliveries) {
            if (d.appointmentId === args.where.appointmentId && d.status === args.where.status) {
              d.status = args.data.status;
              count++;
            }
          }
          return { count };
        },
      },
    };

    const res = await syncAppointmentReminders(mockTx as unknown as Parameters<typeof syncAppointmentReminders>[0], {
      appointmentId: "appt_123",
      userId: "user_456",
      slotStartTime,
      status: AppointmentStatus.CANCELLED,
      now: baseNow,
    });

    assert.equal(res.cancelled, 1);
    assert.equal(mockDeliveries[0].status, DeliveryStatus.CANCELLED);
  });

  it("marks pending reminders SKIPPED when patient checks in", async () => {
    const mockDeliveries: MockDelivery[] = [
      {
        id: "del_1",
        appointmentId: "appt_123",
        template: "reminder",
        status: DeliveryStatus.PENDING,
      },
    ];

    const mockTx = {
      notificationDelivery: {
        updateMany: async (args: { where: { appointmentId: string; status: DeliveryStatus }; data: { status: DeliveryStatus } }) => {
          let count = 0;
          for (const d of mockDeliveries) {
            if (d.appointmentId === args.where.appointmentId && d.status === args.where.status) {
              d.status = args.data.status;
              count++;
            }
          }
          return { count };
        },
      },
    };

    const res = await syncAppointmentReminders(mockTx as unknown as Parameters<typeof syncAppointmentReminders>[0], {
      appointmentId: "appt_123",
      userId: "user_456",
      slotStartTime,
      status: AppointmentStatus.CHECKED_IN,
      now: baseNow,
    });

    assert.equal(res.skipped, 1);
    assert.equal(mockDeliveries[0].status, DeliveryStatus.SKIPPED);
  });
});
