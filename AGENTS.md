<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Medrella Agent Guidelines

### Prisma 7 ORM Architecture
- **Client Location:** Prisma Client is generated explicitly to `src/generated/prisma`. Always import from `@/generated/prisma/client` or use the database singleton from `@/lib/db`.
- **Database Access:** Database access must always go through `src/lib/db/index.ts` via the server-only lazy `db` singleton. Do not instantiate `PrismaClient` directly in components or routes.
- **Connection Strings:**
  - `DATABASE_URL`: Connection-pooled Neon connection string (contains `-pooler`), used at application runtime via `@prisma/adapter-neon` over WebSocket (`ws`).
  - `DIRECT_URL`: Non-pooled direct Neon connection string, strictly required by Prisma CLI for migrations (`prisma.config.ts`).
- **Zero-Credential Build Invariant:** All public routes, builds (`npm run build`), and checks must succeed with zero environment variables. Database connections and secret validation are strictly lazy.
- **Auth.js v5:** Uses JWT session strategy (`session: { strategy: "jwt" }`) with `@auth/prisma-adapter`. Model names in `prisma/schema.prisma` are strictly `User`, `Account`, `Session`, `VerificationToken` mapped via `@@map` to PostgreSQL table names (`users`, `accounts`, `sessions`, `verification_tokens`).
- **Client Components & Server Actions:** Server actions (`"use server"`) must not be defined inline inside client components. Always place them in dedicated action modules under `src/lib/actions/` to prevent server-only modules from leaking into client bundles.
- **Client Component Enum Imports:** In Client Components (`"use client"`) and shared UI utility files, never import runtime enums from `@/generated/prisma/client` (which loads the Node-only `@prisma/client` runtime with `node:module`). Always import enums from `@/generated/prisma/enums` or `@/generated/prisma/browser`, or use `import type`.
- **Race-Safe Consultation Starts:** `startConsultationAction` must execute inside a short database transaction (`maxWait: 10000, timeout: 20000`), locking the doctor row (`SELECT id FROM doctors WHERE id = $1 FOR UPDATE`), verifying the doctor has zero appointments in `IN_CONSULTATION`, and executing a conditional `updateMany` (`WHERE status = 'CHECKED_IN'`).
- **Doctor Absence Slot Restoration Rule:** When a doctor records time off, affected slots are set to `BLOCKED` with `blockedByTimeOffId = timeOff.id`. When the absence is deleted, ONLY slots matching `blockedByTimeOffId = timeOff.id` that have no active appointment are unblocked. Manually blocked slots (`blockedByTimeOffId == null`) must never be touched.
- **Shared Slot Release Helper:** Any flow freeing a slot (patient cancellation, doctor cancellation, rescheduling old slot, absence deletion) must call `src/lib/slots.ts: releaseSlot`. It sets status to `AVAILABLE` unless an active `DoctorTimeOff` covers the slot, in which case it remains `BLOCKED` with `blockedByTimeOffId`.
- **Auto-Confirmed Bookings Architecture:** Doctors manage and publish their own consultation slots; booking a slot IS the confirmation. Appointments are created with status `CONFIRMED` immediately. The doctor confirmation step is removed from doctor workflows.
- **Rescheduling Status Preservation:** Patient rescheduling retains `CONFIRMED` status and does not reset to `PENDING`. Wave assignment is cleared so the rescheduled appointment can be reassigned or included in future waves.
- **Abuse Guard Enforcement:** `bookAppointmentAction` server-side strictly limits patients to at most 3 active upcoming consultations (`CONFIRMED`/`CHECKED_IN` with slot in future) and at most 1 active consultation per doctor per day (IST). Constants reside in `src/lib/constants.ts`.
- **Role & Scope Boundaries:** There is no receptionist role. Outpatient consultations auto-confirm directly.

### Payments, Refunds & Notification Architecture
- **Payment Provider Abstraction:** Payment operations must go through `PaymentProvider` interface in `src/lib/payments/types.ts` via `getPaymentProvider()`. Default implementation is `CashfreeProvider` with `FakePaymentProvider` fallback for testing.
- **Rollout Modes:** Controlled by `PAYMENTS_MODE` env var: `"disabled"` (free booking bypass), `"cashfree"` (live Cashfree checkout). Free consultations (`consultationFee <= 0`) always bypass payment.
- **Checkout Hold Invariant:** Slot checkout creates an appointment in `PENDING_PAYMENT` with `holdExpiresAt = now + 20m` (HOLD_MINUTES = 20) while slot availability is updated to `BOOKED`. Expired holds are released by `expireStaleHolds` running in `/api/cron/tick`.
- **Paise Precision:** All currency logic operates in integer paise internally. Database stores Decimal(10,2) in rupees. Always use helpers in `src/lib/money.ts`.
- **Refund Idempotency:** The `Refund` row (status `REQUESTED`, deterministic `providerRefundId`) MUST be inserted before invoking the gateway. Unique constraint `@@unique([paymentId, reason, appointmentId])` prevents duplicate refunds.
- **Webhook Replay Protection & Idempotency:** Webhook requests must verify HMAC-SHA256 signature and reject timestamps deviating > 5 minutes from server clock with HTTP 401. Webhook events are idempotently tracked in `payment_webhook_events`.
- **Truthful Status Display:** Refund statuses (`REQUESTED`, `PENDING`, `SUCCESS`, `FAILED`) and email notifications must always be truthful and never labeled "Refunded" until provider status is `SUCCESS`.
- **Outbox Email Deliveries:** Transactional emails are scheduled via `notification_deliveries` outbox table and dispatched by `/api/cron/tick` or immediate best-effort send.

