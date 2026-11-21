# Medrella — Doctor Appointment Booking & Clinic Management System

**Live Application:** https://doctorappointmentbookingsystem-pi.vercel.app/

Medrella is a full-stack outpatient healthcare scheduling, clinic queue orchestration, medical records, and digital prescription platform. Built with Next.js 16 (App Router), TypeScript, Prisma ORM 7, Neon Serverless PostgreSQL, Auth.js v5, Cashfree Payments, Resend, and Vercel AI SDK, it connects **Patients**, **Doctors**, **Receptionists**, and **Admins** in a unified, conflict-free clinical workflow.

*Developed as part of the PearlThoughts internship programme.*

---

## Core Capabilities by Role

### Patient Portal
- **Doctor Discovery & Instant Booking (`/doctors`, `/book`):** Browse approved doctors by specialization, fee, and availability, with atomic seat claiming (`CONFIRMED` immediately for free consultations, or 20-minute `PENDING_PAYMENT` checkout hold when payments are enabled).
- **Live Queue & Arrival Tokens (`/patient/dashboard`, `/patient/appointments`):** Automatic sub-slot arrival token assignment, live turn estimation, self-service check-in (`[start - 30 min, end]`), dynamic rescheduling (up to 2 times, including 3-tier alternative suggestions on schedule disruptions), waitlist alerts, and refund tracking (`/patient/payments`).
- **Medical Records & Printable Prescriptions (`/patient/medical-records`, `/patient/prescriptions/[prescriptionId]`):** Structured self-managed medical profile (allergies with severity levels, ongoing/resolved conditions, medications, past medical entries, surgeries, family history, blood group, and emergency contact), chronological clinical timeline, and official read-only printable / Save-as-PDF prescriptions.

### Doctor Portal
- **Wave, Stream & Elastic Scheduling (`/doctor/slots`, `/doctor/waves`, `/doctor/arrival-windows`):** Generate recurring or non-recurring **Wave** schedules (parent + duration sub-slots) and continuous **Stream** windows in IST (`ONCE` overrides only the matching date). Includes elastic **Shrink / Expand** controls and time-off management (`/doctor/time-off`) with precision slot restoration (`blockedByTimeOffId`).
- **Read-Only Live Queue & Clinical Records (`/doctor/queue`, `/doctor/appointments`):** View checked-in, called, and waiting patients without queue-mutation controls, inspect complete patient history via a permanent-`patientId` **View History** drawer (with a pinned allergy safety alert banner), and issue multi-medicine **Prescriptions** with review-and-confirm and idempotent submission.

### Receptionist Queue Desk (`/receptionist`)
- **Centralized Clinic Operations:** Manage check-ins, call patient tokens (`CALLED`), start consultations (`IN_CONSULTATION`), mark consultations completed (`COMPLETED`), and record `NO_SHOW` outcomes across clinic doctors using race-safe database row locks (`FOR UPDATE`).

### Admin Portal (`/admin/dashboard`, `/admin/doctors`, `/admin/payments`, `/admin/waves`)
- Approve or reject practitioner onboarding requests, manage Receptionist role assignments, inspect platform payments/refunds, and monitor clinic operations.

### AI Assistant, Auth & Notifications
- **Voice-Enabled AI Clinic Assistant (`/api/ai-assistant/*`):** Powered by Gemini via `@ai-sdk/google`, with role-isolated patient/doctor tools, persistent chat history, and signed single-use confirmation tokens for state-changing actions.
- **Authentication & Account Lifecycle (`/sign-in`, `/register`, `/forgot-password`, `/reset-password`):** Auth.js v5 JWT sessions combining Google OAuth and bcrypt credentials, SHA-256 single-use password reset links, and blocker-checked account deletion that anonymizes financial-linked ledgers.
- **In-App & Email Notifications (`/notifications`, `/api/cron/tick`):** Real-time navbar notification center paired with a Resend transactional email outbox (`notification_deliveries`) and an opportunistic maintenance runner for stale checkout holds, payment/refund reconciliation, and appointment reminders.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) + React | `16.4.6` / `19.3.0` |
| Language & Validation | TypeScript + Zod | `^5` / `^3.24.2` |
| Styling & UI | Tailwind CSS v4 + shadcn/ui + `@base-ui/react` + Lucide | `^4` / `^4.23.0` |
| Database & ORM | Neon Serverless PostgreSQL + Prisma 7 (`@prisma/adapter-neon`) | `7.10.1` |
| Authentication | Auth.js v5 (`next-auth` + `@auth/prisma-adapter`) + `bcryptjs` | `5.0.0-beta.32` |
| Payments & Email | Cashfree Gateway (`2023-08-01`) + Resend | `1.0.7` / `6.32.1` |
| AI Integration | Vercel AI SDK (`ai` + `@ai-sdk/google`) | `^7.0.171` / `^4.0.119` |

---

## Architecture Highlights

- **Pooled Runtime vs. Direct CLI Connections (`src/lib/db/index.ts`, `prisma.config.ts`):** Runtime queries use Neon's `-pooler` endpoint over WebSockets (`@prisma/adapter-neon`), while Prisma CLI migrations strictly use non-pooled `DIRECT_URL`.
- **Zero-Credential Builds & Lazy Env Validation (`src/lib/env.ts`):** `npm run build` and public pages execute without requiring database or third-party credentials at build time.
- **Atomic Concurrency & Slot Integrity (`src/lib/slots.ts`, `src/lib/queue-actions-core.ts`):** Capacity counters (`activeCount`), partial unique constraints, shared `releaseSlot` restoration, and `SELECT ... FOR UPDATE` doctor row locks prevent double-bookings and race conditions.
- **Idempotent Payments & Webhooks (`src/lib/payments/`, `/api/webhooks/cashfree`):** Integer paise math (`src/lib/money.ts`), HMAC-SHA256 webhook signature and 5-minute replay protection, pre-inserted deterministic `Refund` records, and truthful gateway status syncing.
- **Medical Data Security & Identity Disambiguation (`src/lib/actions/medical-records.ts`, `prescriptions.ts`):** Server-enforced patient ownership, consultation-scoped doctor authorization, permanent `patientId` + `appointmentId` lookups for same-name patients, and immutable doctor-identity snapshots on prescriptions.

---

## Repository Structure

```text
Doc_Booking_System/
├── docs/                         # Architecture docs, DBML schema & ER diagram
├── prisma/
│   ├── schema.prisma             # Complete data model (Auth, Queue, Payments, Medical Records)
│   └── migrations/               # 17 ordered PostgreSQL migrations
├── scripts/                      # Concurrency, payment, email & schema verification scripts
├── src/
│   ├── app/                      # Next.js App Router pages (Patient, Doctor, Receptionist, Admin, API)
│   ├── components/               # Reusable UI, Queue, Medical History Drawer, Prescription & Navbar components
│   ├── generated/prisma/         # Generated Prisma 7 client (git-ignored)
│   └── lib/                      # Auth, DB singleton, scheduling, queue, payments, notifications, actions, validations
├── tests/                        # 20 unit/integration test suites (node:test via tsx)
├── .env.example                  # Complete environment variable template
└── package.json                  # App scripts (`postinstall` runs `prisma generate`)
```

---

## Local Setup & Commands

### Prerequisites
- **Node.js** `>= 20.0.0`
- A **Neon PostgreSQL** database (pooled `DATABASE_URL` and direct `DIRECT_URL`)

### 1. Install Dependencies & Configure Environment
```bash
npm install
cp .env.example .env.local
```
Populate `.env.local` using [`.env.example`](.env.example):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Pooled Neon PostgreSQL URL (`-pooler`) for runtime queries |
| `DIRECT_URL` | CLI/Migrations | Direct (non-pooled) Neon URL for `prisma migrate` |
| `AUTH_SECRET` | Auth/Runtime | Auth.js session encryption key (`npx auth secret`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth | Google Cloud OAuth 2.0 credentials |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | Runtime URLs | `http://localhost:3000` locally; `https://doctorappointmentbookingsystem-pi.vercel.app` in prod |
| `ADMIN_EMAILS` | Optional | Comma-separated emails auto-promoted on verified Google sign-in |
| `PAYMENTS_MODE` | Optional | `"disabled"` (default free bookings) or `"cashfree"` |
| `CASHFREE_KEY_ID`, `CASHFREE_SECRET`, `CASHFREE_ENV`, `CASHFREE_API_VERSION` | If `cashfree` | Cashfree gateway credentials (`sandbox` / `production`, `2023-08-01`) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Optional Email | Transactional email dispatch (`onboarding@resend.dev` in sandbox) |
| `CRON_SECRET` | Optional Maintenance | Bearer secret protecting `/api/cron/tick` |
| `GEMINI_API_KEY` | Optional AI | Enables the AI Clinic Assistant |

### 2. Apply Migrations & Run Development Server
```bash
npm run db:deploy
npm run dev
```
Visit `http://localhost:3000`.

### 3. Quality Checks & Tests
```bash
npm run typecheck   # TypeScript strict check (tsc --noEmit)
npm run lint        # ESLint checks
npm test            # Runs 20 unit & integration suites via tsx --test
npm run build       # Zero-credential Next.js production build
```

---

## Deployment Notes (Vercel & External Services)

- **Production URL:** https://doctorappointmentbookingsystem-pi.vercel.app/
- **Vercel Build:** Set all production environment variables in Vercel Project Settings (`postinstall` automatically runs `prisma generate` before `next build`). Match Vercel Function Region to your Neon region (e.g., `us-east-2` / `iad1`).
- **Migrations:** Run `npm run db:deploy` offline in order before deploying schema-dependent code.
- **Google OAuth & Webhooks:** Configure `https://doctorappointmentbookingsystem-pi.vercel.app/api/auth/callback/google` in Google Cloud Console and `https://doctorappointmentbookingsystem-pi.vercel.app/api/webhooks/cashfree` (API version `2023-08-01`) in Cashfree if payments are enabled.
- **Resend Sandbox:** When using `onboarding@resend.dev`, Resend only delivers to the Resend account owner's email until a custom sender domain is verified.
