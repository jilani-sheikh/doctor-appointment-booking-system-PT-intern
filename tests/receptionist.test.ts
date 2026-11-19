import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AppointmentStatus,
  DoctorStatus,
  Role,
  VisitStream,
  WaveStatus,
} from "../src/generated/prisma/enums";
import { canPatientCheckIn, isValidTransition } from "../src/lib/appointment-status";
import {
  executeCheckInTransaction,
  executeStaffCheckInTransaction,
  type CheckInTransactionClient,
} from "../src/lib/check-in-core";
import { calculateQueueEstimates } from "../src/lib/queue";
import {
  buildReceptionistDashboardData,
  filterReceptionistAppointments,
  type ReceptionistSourceAppointment,
} from "../src/lib/receptionist";
import {
  evaluateRoleRouteAccess,
  getPostLoginRedirectForUser,
  getRoleDashboardPath,
  isProfileCompleteForUser,
} from "../src/lib/role-routing";
import { canAssignStream } from "../src/lib/streams";
import { onboardingSchema } from "../src/lib/validations/auth";
import { createISTDate } from "../src/lib/time";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function createInMemoryCheckInHarness(initial: {
  id: string;
  patientId?: string;
  status: AppointmentStatus;
  doctorId: string;
  patientUserId: string;
  startTime: Date;
  endTime: Date;
  checkedInAt?: Date | null;
  checkedInByUserId?: string | null;
}) {
  const record = {
    id: initial.id,
    patientId: initial.patientId ?? "pat_default",
    status: initial.status,
    doctorId: initial.doctorId,
    patientUserId: initial.patientUserId,
    startTime: initial.startTime,
    endTime: initial.endTime,
    checkedInAt: initial.checkedInAt ?? null,
    checkedInByUserId: initial.checkedInByUserId ?? null,
    remindersSkipped: false,
  };

  let lockChain = Promise.resolve();

  const createTx = (): CheckInTransactionClient => ({
    lockAppointmentRow: async () => {
      const prev = lockChain;
      let release!: () => void;
      lockChain = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prev;
      setTimeout(release, 5);
    },
    findAppointment: async (appointmentId) => {
      if (appointmentId !== record.id) return null;
      return {
        id: record.id,
        patientId: record.patientId,
        status: record.status,
        slotStart: null,
        slotEnd: null,
        availability: {
          doctorId: record.doctorId,
          startTime: record.startTime,
          endTime: record.endTime,
        },
        patient: {
          userId: record.patientUserId,
        },
      };
    },
    conditionalCheckIn: async ({ appointmentId, checkedInAt, checkedInByUserId }) => {
      if (appointmentId !== record.id || record.status !== AppointmentStatus.CONFIRMED) {
        return 0;
      }
      record.status = AppointmentStatus.CHECKED_IN;
      record.checkedInAt = checkedInAt;
      record.checkedInByUserId = checkedInByUserId;
      return 1;
    },
    syncReminders: async ({ status }) => {
      if (status === AppointmentStatus.CHECKED_IN) {
        record.remindersSkipped = true;
      }
    },
  });

  return { record, createTx };
}

test("Auth & RBAC: Role routing strictly isolates Receptionist, Patient, Doctor, and Admin", () => {
  const receptionistUser = { role: Role.RECEPTIONIST, patient: null, doctor: null };
  const patientUser = { role: Role.PATIENT, patient: { id: "pat_1" }, doctor: null };
  const doctorUser = { role: Role.DOCTOR, patient: null, doctor: { id: "doc_1" } };
  const adminUser = { role: Role.ADMIN, patient: null, doctor: null };
  const unassignedUser = { role: null, patient: null, doctor: null };

  assert.equal(isProfileCompleteForUser(receptionistUser), true);
  assert.equal(getRoleDashboardPath(Role.RECEPTIONIST), "/receptionist");
  assert.equal(getPostLoginRedirectForUser(receptionistUser), "/receptionist");
  assert.equal(getPostLoginRedirectForUser(adminUser), "/admin/dashboard");
  assert.equal(getPostLoginRedirectForUser(unassignedUser), "/onboarding");

  // 1. Receptionist can access /receptionist
  assert.deepEqual(evaluateRoleRouteAccess(receptionistUser, [Role.RECEPTIONIST]), {
    allowed: true,
  });

  // 2. Patient cannot access /receptionist
  assert.deepEqual(evaluateRoleRouteAccess(patientUser, [Role.RECEPTIONIST]), {
    allowed: false,
    redirectTo: "/patient/dashboard",
  });

  // 3. Doctor cannot access /receptionist
  assert.deepEqual(evaluateRoleRouteAccess(doctorUser, [Role.RECEPTIONIST]), {
    allowed: false,
    redirectTo: "/doctor/dashboard",
  });

  // 4. Admin access remains unchanged on /admin routes, while /receptionist stays strictly scoped to RECEPTIONIST
  assert.deepEqual(evaluateRoleRouteAccess(adminUser, [Role.ADMIN]), {
    allowed: true,
  });
  assert.deepEqual(evaluateRoleRouteAccess(adminUser, [Role.RECEPTIONIST]), {
    allowed: false,
    redirectTo: "/admin/dashboard",
  });

  // 5 & 6. Receptionist cannot access Doctor or Admin routes
  assert.deepEqual(evaluateRoleRouteAccess(receptionistUser, [Role.DOCTOR]), {
    allowed: false,
    redirectTo: "/receptionist",
  });
  assert.deepEqual(evaluateRoleRouteAccess(receptionistUser, [Role.ADMIN]), {
    allowed: false,
    redirectTo: "/receptionist",
  });
  assert.deepEqual(evaluateRoleRouteAccess(null, [Role.RECEPTIONIST]), {
    allowed: false,
    redirectTo: "/sign-in",
  });
});

test("Public onboarding schema never allows self-assigning RECEPTIONIST or ADMIN roles", () => {
  const receptionistAttempt = onboardingSchema.safeParse({
    role: "RECEPTIONIST",
  });
  assert.equal(receptionistAttempt.success, false);

  const adminAttempt = onboardingSchema.safeParse({
    role: "ADMIN",
  });
  assert.equal(adminAttempt.success, false);
});

test("Server pages, data loaders, and actions enforce strict RBAC boundaries & shared check-in reuse", () => {
  const receptionistPageSrc = readRepoFile("src/app/receptionist/page.tsx");
  assert.match(receptionistPageSrc, /requireRole\(Role\.RECEPTIONIST\)/);

  const receptionistServerSrc = readRepoFile("src/lib/receptionist-server.ts");
  assert.match(receptionistServerSrc, /await requireRole\(Role\.RECEPTIONIST\)/);

  const queueActionsSrc = readRepoFile("src/lib/actions/queue.ts");
  assert.match(queueActionsSrc, /export async function patientCheckInAction[\s\S]*requireRole\(Role\.PATIENT\)[\s\S]*markAppointmentArrived/);
  assert.match(queueActionsSrc, /export async function receptionistCallNextPatientAction[\s\S]*requireRole\(Role\.RECEPTIONIST\)[\s\S]*executeCallNextPatient/);
  assert.match(queueActionsSrc, /export async function receptionistStartConsultationAction[\s\S]*requireRole\(Role\.RECEPTIONIST\)[\s\S]*executeStartConsultation/);
  assert.match(queueActionsSrc, /export async function receptionistMarkArrivedAction[\s\S]*requireRole\(Role\.RECEPTIONIST\)[\s\S]*markAppointmentArrived/);
  assert.match(queueActionsSrc, /export async function receptionistMarkNotArrivedAction[\s\S]*requireRole\(Role\.RECEPTIONIST\)[\s\S]*executeMarkNotArrived/);
  assert.match(queueActionsSrc, /export async function receptionistMarkCompletedAction[\s\S]*requireRole\(Role\.RECEPTIONIST\)[\s\S]*executeMarkCompleted/);
  assert.match(queueActionsSrc, /export async function callNextPatientAction\([\s\S]*?return\s*\{\s*success:\s*false,/);
  assert.match(queueActionsSrc, /export async function startConsultationAction\([\s\S]*?return\s*\{\s*success:\s*false,/);
  assert.match(queueActionsSrc, /export async function endConsultationAction\([\s\S]*?return\s*\{\s*success:\s*false,/);
  assert.match(queueActionsSrc, /export async function doctorMarkArrivedAction\([\s\S]*?return\s*\{\s*success:\s*false,/);
  assert.match(queueActionsSrc, /export async function doctorNoShowAction\([\s\S]*?return\s*\{\s*success:\s*false,/);
  assert.match(queueActionsSrc, /export async function setPriorityStreamAction\([\s\S]*?return\s*\{\s*success:\s*false,/);

  const adminDashboardSrc = readRepoFile("src/app/admin/dashboard/page.tsx");
  assert.match(adminDashboardSrc, /requireRole\(Role\.ADMIN\)/);

  const adminActionsSrc = readRepoFile("src/lib/actions/admin.ts");
  assert.match(adminActionsSrc, /export async function updateReceptionistRoleAction[\s\S]*requireRole\(Role\.ADMIN\)/);
  assert.match(adminActionsSrc, /passwordChangedAt:\s*now/);
  assert.match(adminActionsSrc, /session\.deleteMany/);

  const authSrc = readRepoFile("src/lib/auth.ts");
  assert.match(authSrc, /token\.role\s*=\s*current\?\.role\s*\?\?\s*null/);

  const doctorApptsActionsSrc = readRepoFile("src/lib/actions/doctor-appointments.ts");
  assert.match(doctorApptsActionsSrc, /requireRole\(Role\.DOCTOR\)/);

  // Receptionist manages arrivals (Check In), Call Next Patient, Start Consultation, Completed, and Not Arrived (NO_SHOW),
  // while Priority reordering and Cancellations remain forbidden for Receptionist
  assert.equal(canAssignStream(VisitStream.PRIORITY, Role.RECEPTIONIST), false);
  assert.equal(isValidTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED, Role.RECEPTIONIST), false);
  assert.equal(isValidTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW, Role.RECEPTIONIST), true);
  assert.equal(isValidTransition(AppointmentStatus.CHECKED_IN, AppointmentStatus.CALLED, Role.RECEPTIONIST), true);
  assert.equal(isValidTransition(AppointmentStatus.CALLED, AppointmentStatus.IN_CONSULTATION, Role.RECEPTIONIST), true);
  assert.equal(isValidTransition(AppointmentStatus.CALLED, AppointmentStatus.COMPLETED, Role.RECEPTIONIST), false);
  assert.equal(isValidTransition(AppointmentStatus.IN_CONSULTATION, AppointmentStatus.COMPLETED, Role.RECEPTIONIST), true);
  assert.equal(isValidTransition(AppointmentStatus.CHECKED_IN, AppointmentStatus.CALLED, Role.DOCTOR), false);
  assert.equal(isValidTransition(AppointmentStatus.CALLED, AppointmentStatus.IN_CONSULTATION, Role.DOCTOR), false);
  assert.equal(isValidTransition(AppointmentStatus.IN_CONSULTATION, AppointmentStatus.COMPLETED, Role.DOCTOR), false);
});

test("Check-In: Receptionist checks in confirmed appointments, records timestamp, skips reminders, and prevents duplicates", async () => {
  const slotStart = createISTDate(2026, 11, 17, 10, 0);
  const slotEnd = createISTDate(2026, 11, 17, 10, 30);
  const checkInNow = createISTDate(2026, 11, 17, 9, 42);

  const { record, createTx } = createInMemoryCheckInHarness({
    id: "appt_check_1",
    status: AppointmentStatus.CONFIRMED,
    doctorId: "doc_1",
    patientUserId: "user_pat_1",
    startTime: slotStart,
    endTime: slotEnd,
  });

  // 7 & 11. Receptionist checks in confirmed appointment and records checkedInAt
  const first = await executeStaffCheckInTransaction(createTx(), {
    appointmentId: "appt_check_1",
    actor: { id: "user_rec_1", role: Role.RECEPTIONIST },
    now: checkInNow,
  });

  assert.equal(first.success, true);
  assert.equal(first.checkedInAt, checkInNow.toISOString());
  assert.equal(record.status, AppointmentStatus.CHECKED_IN);
  assert.equal(record.checkedInAt?.toISOString(), checkInNow.toISOString());
  assert.equal(record.checkedInByUserId, "user_rec_1");
  assert.equal(record.remindersSkipped, true);

  // 8. Duplicate check-in is prevented (both Receptionist duplicate and Doctor unauthorized attempt) and original timestamp is preserved
  const laterNow = createISTDate(2026, 11, 17, 9, 50);
  const doctorBlocked = await executeStaffCheckInTransaction(createTx(), {
    appointmentId: "appt_check_1",
    actor: { id: "user_doc_1", role: Role.DOCTOR, doctor: { id: "doc_1", status: DoctorStatus.APPROVED } },
    now: laterNow,
  });
  assert.equal(doctorBlocked.success, false);

  const duplicate = await executeStaffCheckInTransaction(createTx(), {
    appointmentId: "appt_check_1",
    actor: { id: "user_rec_2", role: Role.RECEPTIONIST },
    now: laterNow,
  });

  assert.equal(duplicate.success, false);
  assert.equal(duplicate.alreadyCheckedIn, true);
  assert.equal(record.checkedInAt?.toISOString(), checkInNow.toISOString());
  assert.equal(record.checkedInByUserId, "user_rec_1");
});

test("Check-In: Receptionist desk check-in blocks Doctors and Admins, preserves Patient 30m window, blocked terminal statuses, and concurrent race safety", async () => {
  const slotStart = createISTDate(2026, 11, 17, 11, 0);
  const slotEnd = createISTDate(2026, 11, 17, 11, 30);

  // 10. Both Doctor and Admin are unauthorized for clinic desk check-in while Receptionist succeeds
  const docHarness = createInMemoryCheckInHarness({
    id: "appt_doc_check",
    status: AppointmentStatus.CONFIRMED,
    doctorId: "doc_owner",
    patientUserId: "user_pat_2",
    startTime: slotStart,
    endTime: slotEnd,
  });

  const doctorAttempt = await executeStaffCheckInTransaction(docHarness.createTx(), {
    appointmentId: "appt_doc_check",
    actor: { id: "u_doc_owner", role: Role.DOCTOR, doctor: { id: "doc_owner", status: DoctorStatus.APPROVED } },
  });
  assert.equal(doctorAttempt.success, false);
  assert.equal(docHarness.record.status, AppointmentStatus.CONFIRMED);

  const adminAttempt = await executeStaffCheckInTransaction(docHarness.createTx(), {
    appointmentId: "appt_doc_check",
    actor: { id: "u_admin_1", role: Role.ADMIN },
  });
  assert.equal(adminAttempt.success, false);
  assert.equal(docHarness.record.status, AppointmentStatus.CONFIRMED);

  const receptionistCheckIn = await executeStaffCheckInTransaction(docHarness.createTx(), {
    appointmentId: "appt_doc_check",
    actor: { id: "u_rec_1", role: Role.RECEPTIONIST },
  });
  assert.equal(receptionistCheckIn.success, true);
  assert.equal(docHarness.record.status, AppointmentStatus.CHECKED_IN);

  // 9. Patient 30-minute self check-in window preserved
  assert.equal(
    canPatientCheckIn(
      { status: AppointmentStatus.CONFIRMED, startTime: slotStart, endTime: slotEnd },
      createISTDate(2026, 11, 17, 10, 29)
    ).allowed,
    false
  );
  assert.equal(
    canPatientCheckIn(
      { status: AppointmentStatus.CONFIRMED, startTime: slotStart, endTime: slotEnd },
      createISTDate(2026, 11, 17, 10, 35)
    ).allowed,
    true
  );

  // 12. Cancelled, completed, and NO_SHOW appointments cannot be checked in
  for (const terminalStatus of [
    AppointmentStatus.CANCELLED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.PENDING_PAYMENT,
  ]) {
    const blocked = createInMemoryCheckInHarness({
      id: `appt_${terminalStatus}`,
      status: terminalStatus,
      doctorId: "doc_owner",
      patientUserId: "user_pat_3",
      startTime: slotStart,
      endTime: slotEnd,
    });
    const res = await executeStaffCheckInTransaction(blocked.createTx(), {
      appointmentId: `appt_${terminalStatus}`,
      actor: { id: "user_rec_1", role: Role.RECEPTIONIST },
    });
    assert.equal(res.success, false);
    assert.equal(blocked.record.status, terminalStatus);
    assert.equal(blocked.record.checkedInAt, null);
  }

  // 13. Concurrent check-in requests succeed exactly once without inconsistent state
  const raceHarness = createInMemoryCheckInHarness({
    id: "appt_race",
    status: AppointmentStatus.CONFIRMED,
    doctorId: "doc_owner",
    patientUserId: "user_pat_race",
    startTime: slotStart,
    endTime: slotEnd,
  });

  const [resA, resB] = await Promise.all([
    executeStaffCheckInTransaction(raceHarness.createTx(), {
      appointmentId: "appt_race",
      actor: { id: "user_rec_1", role: Role.RECEPTIONIST },
      now: createISTDate(2026, 11, 17, 10, 45),
    }),
    executeStaffCheckInTransaction(raceHarness.createTx(), {
      appointmentId: "appt_race",
      actor: { id: "user_rec_2", role: Role.RECEPTIONIST },
      now: createISTDate(2026, 11, 17, 10, 46),
    }),
  ]);

  const successCount = [resA, resB].filter((r) => r.success).length;
  assert.equal(successCount, 1);
  assert.equal(raceHarness.record.status, AppointmentStatus.CHECKED_IN);

  // Shared check-in core also executes Patient self check-in cleanly within the 30-min window
  const patHarness = createInMemoryCheckInHarness({
    id: "appt_pat_self",
    patientId: "pat_owner_1",
    status: AppointmentStatus.CONFIRMED,
    doctorId: "doc_owner",
    patientUserId: "user_pat_self",
    startTime: slotStart,
    endTime: slotEnd,
  });

  // Non-owning patient rejected
  const otherPat = await executeCheckInTransaction(patHarness.createTx(), {
    appointmentId: "appt_pat_self",
    actor: { id: "user_other_pat", role: Role.PATIENT, patientId: "pat_other" },
    now: createISTDate(2026, 11, 17, 10, 45),
  });
  assert.equal(otherPat.success, false);

  // Outside 30-minute window rejected
  const tooEarlyPat = await executeCheckInTransaction(patHarness.createTx(), {
    appointmentId: "appt_pat_self",
    actor: { id: "user_pat_self", role: Role.PATIENT, patientId: "pat_owner_1" },
    now: createISTDate(2026, 11, 17, 10, 20),
  });
  assert.equal(tooEarlyPat.success, false);

  // Inside 30-minute window + concurrent Receptionist attempt -> only one succeeds
  const [patSuccess, recRace] = await Promise.all([
    executeCheckInTransaction(patHarness.createTx(), {
      appointmentId: "appt_pat_self",
      actor: { id: "user_pat_self", role: Role.PATIENT, patientId: "pat_owner_1" },
      now: createISTDate(2026, 11, 17, 10, 45),
    }),
    executeCheckInTransaction(patHarness.createTx(), {
      appointmentId: "appt_pat_self",
      actor: { id: "user_rec_1", role: Role.RECEPTIONIST },
      now: createISTDate(2026, 11, 17, 10, 46),
    }),
  ]);
  assert.equal([patSuccess, recRace].filter((r) => r.success).length, 1);
  assert.equal(patHarness.record.status, AppointmentStatus.CHECKED_IN);
  assert.equal(patHarness.record.remindersSkipped, true);
});

test("Queue & Projection: Doctor-wise queues, Wave/Stream/Priority support, exclusions, and search/filtering", () => {
  const now = createISTDate(2026, 11, 17, 10, 20);
  const waveWinStart = createISTDate(2026, 11, 17, 9, 45);
  const waveWinEnd = createISTDate(2026, 11, 17, 10, 0);

  const source: ReceptionistSourceAppointment[] = [
    // Doctor A - Sub-slot 09:30 Completed (Token #1)
    {
      id: "appt_a_1_completed",
      availabilityId: "avail_a_0930",
      tokenNumber: 1,
      status: AppointmentStatus.COMPLETED,
      stream: VisitStream.NEW_CONSULTATION,
      checkedInAt: createISTDate(2026, 11, 17, 9, 25),
      actualStartAt: createISTDate(2026, 11, 17, 9, 30),
      actualEndAt: createISTDate(2026, 11, 17, 9, 55),
      patient: { id: "p1", phone: "9876500001", user: { name: "Rohan Verma", email: "rohan@test.in" } },
      availability: {
        id: "avail_a_0930",
        startTime: createISTDate(2026, 11, 17, 9, 30),
        endTime: createISTDate(2026, 11, 17, 10, 0),
        doctor: { id: "doc_a", specialization: "Cardiology", user: { name: "Ananya" } },
      },
    },
    // Doctor A - Sub-slot 10:00 (CALLED / active Token #1) + Checked-In waiting in SAME sub-slot (Token #2)
    {
      id: "appt_a_2_consulting",
      availabilityId: "avail_a_1000",
      tokenNumber: 1,
      status: AppointmentStatus.IN_CONSULTATION,
      stream: VisitStream.PRIORITY,
      checkedInAt: createISTDate(2026, 11, 17, 9, 50),
      actualStartAt: createISTDate(2026, 11, 17, 10, 0),
      patient: { id: "p2", phone: "9876500002", user: { name: "Meena Joshi", email: "meena@test.in" } },
      availability: {
        id: "avail_a_1000",
        startTime: createISTDate(2026, 11, 17, 10, 0),
        endTime: createISTDate(2026, 11, 17, 10, 15),
        doctor: { id: "doc_a", specialization: "Cardiology", user: { name: "Ananya" } },
      },
    },
    {
      id: "appt_a_3_cancelled",
      availabilityId: "avail_a_1015",
      tokenNumber: 1,
      status: AppointmentStatus.CANCELLED,
      stream: VisitStream.FOLLOW_UP,
      checkedInAt: createISTDate(2026, 11, 17, 9, 55), // even if checked in prior to cancellation, must NOT count as checked-in or total
      patient: { id: "p3", phone: "9876500003", user: { name: "Cancelled Patient", email: null } },
      availability: {
        id: "avail_a_1015",
        startTime: createISTDate(2026, 11, 17, 10, 15),
        endTime: createISTDate(2026, 11, 17, 10, 30),
        doctor: { id: "doc_a", specialization: "Cardiology", user: { name: "Ananya" } },
      },
    },
    {
      id: "appt_a_4_noshow",
      availabilityId: "avail_a_1020",
      tokenNumber: 1,
      status: AppointmentStatus.NO_SHOW,
      stream: VisitStream.NEW_CONSULTATION,
      patient: { id: "p4", phone: "9876500004", user: { name: "NoShow Patient", email: null } },
      availability: {
        id: "avail_a_1020",
        startTime: createISTDate(2026, 11, 17, 10, 20),
        endTime: createISTDate(2026, 11, 17, 10, 30),
        doctor: { id: "doc_a", specialization: "Cardiology", user: { name: "Ananya" } },
      },
    },
    {
      id: "appt_a_5_checked_in",
      availabilityId: "avail_a_1000",
      tokenNumber: 2,
      status: AppointmentStatus.CHECKED_IN,
      stream: VisitStream.FOLLOW_UP,
      checkedInAt: createISTDate(2026, 11, 17, 10, 5),
      wave: { windowStart: waveWinStart, windowEnd: waveWinEnd, status: WaveStatus.PUBLISHED },
      patient: { id: "p5", phone: "9876500005", user: { name: "Priya Nair", email: "priya@test.in" } },
      availability: {
        id: "avail_a_1000",
        startTime: createISTDate(2026, 11, 17, 10, 0),
        endTime: createISTDate(2026, 11, 17, 10, 15),
        doctor: { id: "doc_a", specialization: "Cardiology", user: { name: "Ananya" } },
      },
    },
    // Doctor B - Active checkout hold excluded from live sub-slot queue + confirmed Stream appointment (Token #1)
    {
      id: "appt_hold_today",
      availabilityId: "avail_b_1030",
      tokenNumber: null,
      status: AppointmentStatus.PENDING_PAYMENT,
      stream: VisitStream.NEW_CONSULTATION,
      patient: { id: "p7", phone: null, user: { name: "Hold User", email: null } },
      availability: {
        id: "avail_b_1030",
        startTime: createISTDate(2026, 11, 17, 10, 30),
        endTime: createISTDate(2026, 11, 17, 11, 0),
        doctor: { id: "doc_b", specialization: "Orthopedics", user: { name: "Arjun" } },
      },
    },
    {
      id: "appt_b_1_confirmed",
      availabilityId: "avail_b_stream",
      tokenNumber: 1,
      status: AppointmentStatus.CONFIRMED,
      stream: VisitStream.NEW_CONSULTATION,
      slotStart: createISTDate(2026, 11, 17, 11, 0),
      slotEnd: createISTDate(2026, 11, 17, 11, 20),
      patient: { id: "p6", phone: null, user: { name: "Karan Patel", email: "karan@test.in" } },
      availability: {
        id: "avail_b_stream",
        startTime: createISTDate(2026, 11, 17, 9, 0),
        endTime: createISTDate(2026, 11, 17, 13, 0),
        doctor: { id: "doc_b", specialization: "Orthopedics", user: { name: "Arjun" } },
      },
    },
    {
      id: "appt_tomorrow_ignored",
      availabilityId: "avail_b_tmrw",
      tokenNumber: 1,
      status: AppointmentStatus.CONFIRMED,
      stream: VisitStream.NEW_CONSULTATION,
      patient: { id: "p8", phone: null, user: { name: "Tomorrow User", email: null } },
      availability: {
        id: "avail_b_tmrw",
        startTime: createISTDate(2026, 11, 18, 10, 0),
        endTime: createISTDate(2026, 11, 18, 10, 30),
        doctor: { id: "doc_b", specialization: "Orthopedics", user: { name: "Arjun" } },
      },
    },
  ];

  const data = buildReceptionistDashboardData(source, now);

  // Overview counts exclude CANCELLED and PENDING_PAYMENT holds from Total Today & Checked-In
  assert.equal(data.overview.totalAppointmentsToday, 5); // 1 completed + 1 in_consultation + 1 checked_in + 1 no_show + 1 confirmed (excludes cancelled & hold)
  assert.equal(data.overview.completedConsultations, 1);
  assert.equal(data.overview.inConsultation, 1);
  assert.equal(data.overview.waitingPatients, 1);
  assert.equal(data.overview.checkedInPatients, 3); // completed (had checkedInAt), in_consultation, checked_in (NEVER cancelled)
  assert.equal(data.overview.noShowPatients, 1);
  assert.equal(data.overview.cancelledAppointments, 1);
  assert.equal(data.overview.paymentHoldAppointments, 1);
  assert.equal(data.overview.awaitingArrival, 1);

  // Independent sub-slot queues exclude PENDING_PAYMENT holds and preserve persisted tokens
  assert.equal(data.doctorQueues.length, 2);
  const queueA = data.doctorQueues.find((q) => q.doctorId === "doc_a")!;
  const queueB = data.doctorQueues.find((q) => q.doctorId === "doc_b")!;

  assert.equal(queueA.currentlyConsulting?.id, "appt_a_2_consulting");
  assert.equal(queueA.currentlyConsulting?.stream, VisitStream.PRIORITY);
  assert.equal(queueA.nextPatient?.id, "appt_a_5_checked_in");
  assert.ok(queueA.nextPatient?.arrivalWindow); // Wave arrival window preserved
  assert.equal(queueA.activeQueue.length, 2); // Cancelled, No-Show, Completed excluded from active queue
  assert.equal(queueA.activeQueue[0]?.queuePosition, 1);
  assert.equal(queueA.activeQueue[0]?.tokenNumber, 1);
  assert.equal(queueA.activeQueue[1]?.queuePosition, 2);
  assert.equal(queueA.activeQueue[1]?.tokenNumber, 2); // Priya keeps Token #2

  // Doctor B queue excludes PENDING_PAYMENT hold from activeQueue & preserves confirmed Stream slot #1
  const docBExpectedEstimates = calculateQueueEstimates(
    [
      {
        id: "appt_b_1_confirmed",
        status: AppointmentStatus.CONFIRMED,
        scheduledStart: createISTDate(2026, 11, 17, 11, 0),
        scheduledEnd: createISTDate(2026, 11, 17, 11, 20),
        tokenNumber: 1,
      },
    ],
    now
  );
  assert.equal(queueB.activeQueue.length, 1);
  assert.equal(queueB.activeQueue[0]?.id, "appt_b_1_confirmed");
  assert.equal(queueB.activeQueue[0]?.tokenNumber, 1);
  assert.equal(
    queueB.activeQueue[0]?.queuePosition,
    docBExpectedEstimates.get("appt_b_1_confirmed")?.queuePosition
  );
  assert.equal(
    queueB.activeQueue[0]?.expectedStart,
    docBExpectedEstimates.get("appt_b_1_confirmed")?.expectedStart.toISOString()
  );
  assert.equal(queueB.activeQueue[0]?.scheduledStart, createISTDate(2026, 11, 17, 11, 0).toISOString());
  assert.equal(queueB.activeQueue[0]?.scheduledEnd, createISTDate(2026, 11, 17, 11, 20).toISOString());
  assert.equal(queueB.activeQueue[0]?.contact, "karan@test.in");

  const holdRow = data.appointments.find((a) => a.id === "appt_hold_today")!;
  assert.equal(holdRow.canCheckIn, false);
  assert.equal(holdRow.tokenNumber, null);
  assert.equal(holdRow.queuePosition, null);

  // Cancelled & No-Show excluded from queue positions and never counted as checked-in
  const cancelledItem = data.appointments.find((a) => a.id === "appt_a_3_cancelled")!;
  const noShowItem = data.appointments.find((a) => a.id === "appt_a_4_noshow")!;
  assert.equal(cancelledItem.queuePosition, null);
  assert.equal(cancelledItem.isCheckedIn, false);
  assert.equal(noShowItem.queuePosition, null);

  // After currently active patient completes consultation, remaining waiting patient shifts to Queue Pos #1 while KEEPING persisted Token #2
  const updatedSource = source.map((a) =>
    a.id === "appt_a_2_consulting"
      ? { ...a, status: AppointmentStatus.COMPLETED, actualEndAt: createISTDate(2026, 11, 17, 10, 22) }
      : a
  );
  const afterComplete = buildReceptionistDashboardData(updatedSource, createISTDate(2026, 11, 17, 10, 22));
  const afterQueueA = afterComplete.doctorQueues.find((q) => q.doctorId === "doc_a")!;
  assert.equal(afterQueueA.activeQueue.length, 1);
  assert.equal(afterQueueA.activeQueue[0]?.id, "appt_a_5_checked_in");
  assert.equal(afterQueueA.activeQueue[0]?.queuePosition, 1);
  assert.equal(afterQueueA.activeQueue[0]?.tokenNumber, 2);

  // Filters & search (patient name, token #, appointment ref, doctor, status, check-in status)
  assert.equal(
    filterReceptionistAppointments(data.appointments, {
      search: "Priya",
      doctorId: "ALL",
      appointmentStatus: "ALL",
      checkInStatus: "ALL",
    }).length,
    1
  );
  assert.equal(
    filterReceptionistAppointments(data.appointments, {
      search: "#2",
      doctorId: "ALL",
      appointmentStatus: "ALL",
      checkInStatus: "ALL",
    }).length,
    1 // Priya Token #2 in Doctor A 10:00 sub-slot
  );
  assert.equal(
    filterReceptionistAppointments(data.appointments, {
      search: "FIRMED", // matches appointment referenceCode suffix
      doctorId: "doc_b",
      appointmentStatus: AppointmentStatus.CONFIRMED,
      checkInStatus: "NOT_CHECKED_IN",
    }).length,
    1
  );
  assert.equal(
    filterReceptionistAppointments(data.appointments, {
      search: "karan@test.in",
      doctorId: "ALL",
      appointmentStatus: "ALL",
      checkInStatus: "NOT_CHECKED_IN",
    }).length,
    1
  );
});
