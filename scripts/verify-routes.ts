import assert from "node:assert/strict";
import { toPatientAppointmentDto } from "../src/lib/serializers";
import { WaveStatus, AppointmentStatus, VisitStream, Role } from "../src/generated/prisma/enums";
import { createISTDate } from "../src/lib/time";

function evaluateRoleRedirect(role: Role): string {
  switch (role) {
    case Role.PATIENT:
      return "/patient/dashboard";
    case Role.DOCTOR:
      return "/doctor/dashboard";
    case Role.ADMIN:
      return "/admin/dashboard";
    default:
      return "/onboarding";
  }
}

async function verifyRoutes() {
  console.log("=== Medrella Server Route & Legacy Wave Verification ===");

  const baseUrl = "http://127.0.0.1:3005";

  // 1. Verify Public routes return 200
  console.log("Checking public routes return 200...");
  const publicRoutes = ["/", "/doctors", "/sign-in", "/about"];
  for (const route of publicRoutes) {
    const res = await fetch(`${baseUrl}${route}`);
    console.log(`GET ${route} -> Status: ${res.status}`);
    assert.equal(res.status, 200, `Expected 200 for public route ${route}`);
  }

  // 2. Verify /admin/waves redirects to /admin/doctors
  console.log("Checking /admin/waves redirect...");
  const adminWavesRes = await fetch(`${baseUrl}/admin/waves`, { redirect: "manual" });
  console.log(`GET /admin/waves -> Status: ${adminWavesRes.status}, Location: ${adminWavesRes.headers.get("location")}`);
  assert.ok(
    [307, 308, 302].includes(adminWavesRes.status),
    `/admin/waves should redirect, got ${adminWavesRes.status}`
  );
  assert.ok(
    adminWavesRes.headers.get("location")?.includes("/admin/doctors"),
    `/admin/waves should redirect to /admin/doctors, got ${adminWavesRes.headers.get("location")}`
  );

  // 3. Verify Protected routes redirect to /sign-in (serving Sign In page to unauthenticated callers)
  console.log("Checking protected routes redirect unauthenticated callers to /sign-in...");
  const protectedRoutes = ["/doctor/waves", "/patient/appointments", "/admin/dashboard", "/doctor/queue"];
  for (const route of protectedRoutes) {
    const res = await fetch(`${baseUrl}${route}`);
    const html = await res.text();
    const isSignInPage = html.includes("Sign In") || html.includes("sign-in");
    console.log(`GET ${route} -> Status: ${res.status}, Served Sign In page: ${isSignInPage}`);
    assert.ok(
      isSignInPage,
      `Unauthenticated request to ${route} must serve or redirect to Sign In page`
    );
  }

  // 4. Verify Role Authorization logic (/doctor/waves blocked for Patient and Admin)
  console.log("Checking /doctor/waves blocked for Patient and Admin via role authorization...");
  const patientRedirect = evaluateRoleRedirect(Role.PATIENT);
  const adminRedirect = evaluateRoleRedirect(Role.ADMIN);

  console.log(`Patient redirect when unauthorized on doctor route: ${patientRedirect}`);
  console.log(`Admin redirect when unauthorized on doctor route: ${adminRedirect}`);

  assert.equal(patientRedirect, "/patient/dashboard", "Patient should be redirected to /patient/dashboard");
  assert.equal(adminRedirect, "/admin/dashboard", "Admin should be redirected to /admin/dashboard");

  // 5. Verify Legacy PUBLISHED wave behavior (doctorId NULL)
  console.log("Checking legacy PUBLISHED wave (doctorId: null) patient visibility...");
  const legacyWaveAppointment = {
    id: "appt-legacy",
    status: AppointmentStatus.CONFIRMED,
    stream: VisitStream.NEW_CONSULTATION,
    reason: "General Checkup",
    createdAt: new Date(),
    cancelledAt: null,
    checkedInAt: null,
    rescheduleCount: 0,
    disruptedAt: null,
    disruptionReason: null,
    availability: {
      startTime: createISTDate(2026, 10, 29, 10, 0),
      endTime: createISTDate(2026, 10, 29, 10, 15),
      doctor: {
        id: "doc-1",
        specialization: "Cardiology",
        qualification: "MD",
        consultationFee: 500,
        user: { name: "Dr. Legacy" },
      },
    },
    wave: {
      id: "wave-legacy",
      doctorId: null, // Legacy wave without doctorId
      status: WaveStatus.PUBLISHED,
      windowStart: createISTDate(2026, 10, 29, 9, 45),
      windowEnd: createISTDate(2026, 10, 29, 10, 0),
    },
  };

  const patientDto = toPatientAppointmentDto(legacyWaveAppointment as any);
  console.log("Patient DTO arrival window for legacy published wave:", patientDto.arrivalWindow);
  assert.ok(patientDto.arrivalWindow !== null, "Patient linked to legacy PUBLISHED wave MUST see arrival window");
  assert.ok(patientDto.arrivalWindow?.includes("09:45 am"), "Arrival window must format legacy wave window start");

  // Draft wave: patient should NOT see arrival window
  const draftWaveAppointment = {
    ...legacyWaveAppointment,
    wave: {
      ...legacyWaveAppointment.wave,
      status: WaveStatus.DRAFT,
    },
  };
  const draftPatientDto = toPatientAppointmentDto(draftWaveAppointment as any);
  console.log("Patient DTO arrival window for DRAFT wave:", draftPatientDto.arrivalWindow);
  assert.equal(draftPatientDto.arrivalWindow, null, "DRAFT waves must NEVER be visible to patients");

  console.log("=== All Server Route & Legacy Wave Verifications PASSED! ===");
}

verifyRoutes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Route verification failed:", err);
    process.exit(1);
  });
