# Medrella — Doctor Appointment Booking System

Medrella is a full-stack doctor appointment scheduling web application connecting patients with healthcare professionals, managing doctor availability, and facilitating conflict-free consultation bookings.

Developed as part of the PearlThoughts internship programme.

---

## 📌 Project Overview

Medrella aims to provide a reliable, modern healthcare platform for managing users, patient profiles, doctor profiles, availability slots, and appointment workflows.

The application supports:
- **Phase 1 (Completed):** Secure project foundation, light healthcare design system, Prisma ORM database migration infrastructure with Neon PostgreSQL, and Google OAuth via Auth.js v5.
- **Future Phases:** Role-based access (patients/doctors), availability slot management, appointment booking lifecycle, notifications, and payments.

---

## 🛠️ Technology Stack (Phase 1)

| Technology | Purpose | Version |
|---|---|---|
| **Next.js** (App Router) | React full-stack framework with Turbopack | `16.4.3` |
| **React** | Component architecture & modern hooks | `19.3.0` |
| **TypeScript** | Strict compile-time type safety | `^5` |
| **Tailwind CSS** | Styling engine with `@tailwindcss/postcss` | `^4` |
| **shadcn/ui** | Accessible UI primitives (Button, Avatar, Card, DropdownMenu, Sheet) | `4.23.0` |
| **PostgreSQL on Neon** | Serverless relational database via `@neondatabase/serverless` | `^1.2.0` |
| **Prisma ORM** | Next-generation ORM with Neon Driver Adapter | `7.10.1` |
| **@prisma/adapter-neon** | Official Prisma driver adapter for Neon Serverless | `7.10.1` |
| **Auth.js (NextAuth v5)** | Authentication with `@auth/prisma-adapter` & Google OAuth | `5.0.0-beta.32` |
| **Zod** | Lazy runtime environment validation & schemas | `^3.24.2` |

---

## 🏗️ Architectural Decisions

### 1. JWT Session Strategy with Prisma Adapter
Medrella configures Auth.js v5 with `session: { strategy: "jwt" }` combined with `@auth/prisma-adapter`:
- **Account Persistence:** On successful Google OAuth sign-in, Auth.js creates and links the user and account records in Neon PostgreSQL via the Prisma adapter.
- **Performance & Edge-Friendliness:** Instead of making blocking database round-trips on every page navigation to inspect a database session row, the session state is cryptographically signed and stored in a secure cookie.
- **Zero-Credential Builds:** Public landing pages render without database queries, keeping the application fast, resilient, and cost-effective.

### 2. Neon Pooled vs. Direct Connection Strings
Prisma and Neon recommend two distinct connection strings:
- **`DATABASE_URL` (Pooled Connection)**: Used at application runtime by `@prisma/adapter-neon`. Connects to Neon's PgBouncer/WebSocket connection pooler (host containing `-pooler`) to prevent connection exhaustion in serverless environments.
- **`DIRECT_URL` (Direct Connection)**: Used exclusively by the Prisma CLI for migrations (`npm run db:migrate`, `npm run db:deploy`). Prisma migrations require non-pooled direct connections to support advisory locks and transaction statements.

### 3. Lazy Environment Validation
All environment variables are validated lazily on demand (`src/lib/env.ts`):
- `npm run build` and public landing page visits require zero environment variables.
- When an operation requiring credentials is run (e.g. initiating Google OAuth or running a database query), Zod validates the specific variable and provides an explicit, actionable error message naming the exact missing variable.
- `prisma.config.ts` strictly prevents migrations from running if `DIRECT_URL` is missing.

### 4. Server-Only Database Client & Serverless Lifecycle
The database client (`src/lib/db/index.ts`) enforces `import "server-only"` and maintains a lazy singleton pattern on `globalThis` across both development and production serverless invocations. The `@prisma/adapter-neon` WebSocket connection pool is created only when SQL queries are executed, with `connectionTimeoutMillis: 10000` to smoothly handle Neon compute cold starts without premature timeouts.

### 5. Vercel Deployment & Region Configuration
When deploying to Vercel:
- **Function Region (`preferredRegion`):** Ensure your Vercel Function Region (Settings > Functions > Function Region) matches the geographical region of your Neon PostgreSQL database (e.g. `iad1` (Washington, D.C.) or `cle1` (Cleveland) for Neon databases hosted in AWS `us-east-2`). Placing functions near the database avoids unnecessary cross-continental WebSocket round-trip latencies.
- **Production Environment Variables:** Set `DATABASE_URL` (strictly the pooled connection containing `-pooler`), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `ADMIN_EMAILS`. Do not set `DIRECT_URL` as `DATABASE_URL`.
- **Neon Compute Autosuspend:** Neon compute instances on free plans sleep after 5 minutes of inactivity. When a cold start occurs, waking the compute node may take 2–5 seconds. All interactive transactions specify `{ maxWait: 10000, timeout: 20000 }` to tolerate cold starts.

---

## 📂 Repository Structure

```text
Doc_Booking_System/
├── .env.example              # Environment variables template (pooled vs direct)
├── .gitignore                # Excludes secrets, generated client, and build artifacts
├── README.md                 # Project documentation and setup guide
├── components.json           # shadcn/ui configuration
├── prisma.config.ts          # Prisma 7 CLI configuration (loads .env.local, enforces DIRECT_URL)
├── next.config.ts            # Next.js configuration (remotePatterns for Google avatars)
├── package.json              # Project scripts and dependencies
├── postcss.config.mjs        # PostCSS configuration with Tailwind v4
├── tsconfig.json             # TypeScript configuration (@/* alias, strict mode)
├── docs/
│   ├── Doctor Appointment Booking System.png  # Entity Relationship Diagram
│   └── doctor-appointment-booking-system.dbml # Editable DBML source
├── prisma/
│   ├── schema.prisma         # Prisma schema (Auth.js adapter models)
│   └── migrations/
│       ├── migration_lock.toml
│       └── 20261027000000_init/
│           └── migration.sql # Initial SQL migration
└── src/
    ├── generated/
    │   └── prisma/           # Generated Prisma Client (git-ignored)
    ├── app/
    │   ├── layout.tsx        # Root layout (Navbar, Footer, SEO metadata)
    │   ├── page.tsx          # Landing page (Hero, Benefits, How It Works)
    │   ├── globals.css       # Tailwind v4 theme tokens & healthcare styles
    │   ├── api/auth/[...nextauth]/route.ts  # Auth.js HTTP route handler
    │   ├── doctors/page.tsx  # Doctors directory (Coming soon placeholder)
    │   ├── book/page.tsx     # Appointment booking (Coming soon placeholder)
    │   └── about/page.tsx    # About page (Coming soon placeholder)
    ├── components/
    │   ├── layout/
    │   │   ├── auth-button.tsx  # Sign In / Avatar Dropdown Menu
    │   │   ├── footer.tsx       # Platform footer
    │   │   └── navbar.tsx       # Responsive header with mobile sheet
    │   └── ui/               # shadcn UI primitives (button, avatar, card, sheet, etc.)
    ├── lib/
    │   ├── auth.ts           # Auth.js config and server helpers (getCurrentUser, requireUser)
    │   ├── env.ts            # Lazy Zod environment variable validator
    │   ├── utils.ts          # Classname helper (cn)
    │   ├── actions/
    │   │   └── auth.ts       # Server Actions (signInAction, signOutAction)
    │   └── db/
    │       └── index.ts      # Server-only lazy PrismaClient with Neon driver adapter
    └── types/
        └── next-auth.d.ts    # Module augmentations for NextAuth Session and User
```

---

## ⚙️ Environment Variables

Create `.env.local` in the project root:

```env
# Neon PostgreSQL POOLED connection string (Runtime queries via @prisma/adapter-neon)
DATABASE_URL="postgresql://[user]:[password]@[neon-hostname]-pooler.[region].aws.neon.tech/[database]?sslmode=require"

# Neon PostgreSQL DIRECT connection string (Used exclusively by Prisma CLI for migrations)
DIRECT_URL="postgresql://[user]:[password]@[neon-hostname].[region].aws.neon.tech/[database]?sslmode=require"

# Auth.js secret (generate using `npx auth secret` or `openssl rand -base64 33`)
AUTH_SECRET="your-32-char-random-secret"

# Google Cloud OAuth 2.0 Credentials
AUTH_GOOGLE_ID="your-client-id.apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="your-client-secret"

# Optional (Vercel automatically sets this in production)
# AUTH_URL="https://your-deployment.vercel.app"
```

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```
*(The `postinstall` script automatically runs `prisma generate` to compile the Prisma client to `src/generated/prisma`).*

### 2. Run Local Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the Medrella landing page.

### 3. Verification & Code Quality
```bash
# Generate Prisma Client
npm run db:generate

# ESLint check (zero errors, zero warnings)
npm run lint

# TypeScript compilation check
npm run typecheck

# Production build (must succeed with NO credentials set)
npm run build
```

---

## 🗄️ Database Setup (Neon PostgreSQL)

1. Sign up or log into [Neon](https://neon.tech).
2. Create a new project (e.g. `medrella-db`).
3. Under **Dashboard > Connection Details**:
   - Check the **Pooled connection** checkbox to copy your **`DATABASE_URL`**.
   - Uncheck the **Pooled connection** checkbox to copy your direct **`DIRECT_URL`**.
4. Paste both into `.env.local`:
   ```env
   DATABASE_URL="postgresql://...-pooler....neon.tech/neondb?sslmode=require"
   DIRECT_URL="postgresql://...neon.tech/neondb?sslmode=require"
   ```
5. Apply the initial migration to your Neon database:
   ```bash
   npm run db:migrate
   ```
   *(Or in production CI/CD environments: `npm run db:deploy`).*
6. (Optional) Open Prisma Studio to inspect database records visually:
   ```bash
   npm run db:studio
   ```

---

## ☁️ Vercel Deployment Note

- **Node Version**: Node.js `>=20.0.0` is required (enforced via `"engines"` in `package.json`). Ensure Vercel project settings are configured for Node 20.x or 22.x.
- **Environment Variables**: Set `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` in your Vercel Project Settings > Environment Variables.
- **Prisma Client Build**: The `"postinstall": "prisma generate"` script in `package.json` guarantees that Vercel automatically generates the Prisma Client in `src/generated/prisma` during the deployment build step before Next.js compiles.

---

## 🔐 Google OAuth Configuration

1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project named **Medrella**.
3. Navigate to **APIs & Services > OAuth consent screen**:
   - User Type: **External**
   - App name: `Medrella`
   - User support email & Developer contact email: your email
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   - Add test users if the app remains in "Testing" mode.
4. Navigate to **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - Application type: **Web application**
   - Name: `Medrella Web Client`
   - **Authorized JavaScript origins**:
     - `http://localhost:3000`
     - `https://<your-vercel-domain>.vercel.app` (for production)
   - **Authorized redirect URIs**:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://<your-vercel-domain>.vercel.app/api/auth/callback/google`
5. Copy the generated **Client ID** and **Client Secret** into `.env.local`:
   ```env
   AUTH_GOOGLE_ID="..."
   AUTH_GOOGLE_SECRET="..."
   ```

---

## 📋 Project Status & Roadmap

- [x] Initial ER diagram and DBML documentation.
- [x] **Phase 1: Project Setup and Secure Foundation**
  - [x] Next.js 16 App Router + TypeScript + Tailwind CSS v4 setup.
  - [x] shadcn/ui component integration.
  - [x] Neon PostgreSQL + Prisma ORM 7 setup with `@prisma/adapter-neon`.
  - [x] Initial timestamped migration file generated (`prisma/migrations/20261027000000_init`).
  - [x] Auth.js v5 with Google provider & `@auth/prisma-adapter`.
  - [x] Lazy Zod environment validation (zero-credential build support).
  - [x] Responsive healthcare landing page with "Coming soon" placeholders.
- [x] **Phase 2: User Profiles & Roles** (Patients, Doctors, Admin).
- [x] **Phase 3: Doctor Availability Module** (Slots & calendar scheduling, bulk generator).
- [x] **Phase 4: Appointment Booking & Lifecycle Management** (Double-booking prevention, partial unique index).
- [x] **Phase 5: Live Queue, Waves, Streams, Dynamic Scheduling & Notifications**
  - [x] Live Doctor Queue & Patient Turn Estimates.
  - [x] Wave-based Arrival Management & Overflow Balancing.
  - [x] Clinical Visit Streams (`NEW_CONSULTATION`, `FOLLOW_UP`, `PRIORITY`).
  - [x] Dynamic Scheduling: Self-Service Rescheduling (max 2) & Automated Waitlist.
  - [x] Doctor Absence Management with Precision Slot Restoration (`blockedByTimeOffId`).
  - [x] In-App Notification Center with Bell Indicator and Debounced Triggers.
  - [x] Race-Safe Consultation Starting via PostgreSQL Doctor Row Locking.

---

## 🚦 Appointment Status Model & Transition Matrix

The consultation workflow is governed by strict, clinically validated state transitions (`src/lib/appointment-status.ts`):

```
       ┌───────────┐
       │  PENDING  ├──────────────┐ (Patient/Doctor/Admin Cancel)
       └─────┬─────┘              │
             │ (Doctor Confirm)   ▼
       ┌─────▼─────┐       ┌─────────────┐
       │ CONFIRMED ├──────►│  CANCELLED  │ [Terminal]
       └──┬──────┬─┘       └─────────────┘
          │      │ (Doctor/Admin No-Show after 15m)
          │      ▼
          │  ┌─────────┐
          │  │ NO_SHOW │ [Terminal]
          │  └─────────┘
          │ (Patient self-check-in: start - 30m to end; or Doctor override)
       ┌──▼────────┐
       │CHECKED_IN ├──────────────┐ (Doctor/Admin Cancel/No-Show)
       └──┬────────┘              │
          │ (Doctor Start: race-safe lock)
       ┌──▼──────────────┐        │
       │ IN_CONSULTATION ├────────┘
       └──┬──────────────┘
          │ (Doctor Complete)
       ┌──▼────────┐
       │ COMPLETED │ [Terminal]
       └───────────┘
```

### Transition Permission Matrix

| Current Status | Target Status | Permitted Roles | Conditions & Constraints |
|---|---|---|---|
| `PENDING` | `CONFIRMED` | Doctor, Admin | Practitioner accepts booking request. |
| `PENDING` | `CANCELLED` | Patient, Doctor, Admin | Patient can cancel anytime while PENDING. Slot is released. |
| `CONFIRMED` | `CHECKED_IN` | Patient, Doctor, Admin | Patient self-check-in allowed within `[start - 30 min, end]`. Staff can check in on arrival. |
| `CONFIRMED` | `CANCELLED` | Patient, Doctor, Admin | Patient requires ≥ 2h notice unless consultation was disrupted by doctor absence. |
| `CONFIRMED` | `NO_SHOW` | Doctor, Admin | Allowed only after `start + 15 min` grace period. |
| `CHECKED_IN` | `IN_CONSULTATION` | Doctor | Doctor row locked `FOR UPDATE`. Doctor must have 0 current `IN_CONSULTATION` appointments. |
| `CHECKED_IN` | `CANCELLED` | Doctor, Admin | Emergency cancellation by clinic staff. Slot released. |
| `CHECKED_IN` | `NO_SHOW` | Doctor, Admin | If patient leaves clinic before consultation. |
| `IN_CONSULTATION` | `COMPLETED` | Doctor | Consultation finishes successfully. |
| `COMPLETED` | *(None)* | — | Terminal state. Slot is historical. |
| `CANCELLED` | *(None)* | — | Terminal state. Slot released to waitlist or available. |
| `NO_SHOW` | *(None)* | — | Terminal state. Cannot be reopened. |

---

## ⏱️ Live Queue Estimation & Delay Propagation

The queue estimation engine (`src/lib/queue.ts`) calculates approximate start and completion times in real-time without constant slot assumptions:

1. **Dynamic Slot Durations:** Slot duration is derived directly from each availability's own `(endTime - startTime)`. Different appointments can have different lengths (e.g. 15m, 30m, 45m).
2. **Current Consultation Overrun:** If an appointment is `IN_CONSULTATION`:
   $$\text{expectedEnd} = \max(\text{now}, \text{actualStartAt} + \text{slotDuration})$$
   $$\text{overrunMinutes} = \max(0, \text{now} - (\text{actualStartAt} + \text{slotDuration}))$$
3. **Subsequent Appointments:**
   $$\text{expectedStart} = \max(\text{scheduledStart}, \text{previousExpectedEnd})$$
   $$\text{expectedEnd} = \text{expectedStart} + \text{slotDuration}$$
   $$\text{delayMinutes} = \max(0, \text{expectedStart} - \text{scheduledStart})$$
4. **Historical Guard Rule:** If the previous slot has passed and nothing is currently in progress, previous `expectedEnd` defaults to its scheduled end time (not `now`), preventing false delay inflation before the doctor logs in.
5. **Display Approximation:** Delays are rounded to the nearest 5 minutes (`roundToNearest5Minutes`) and prominently labelled "Approximate" with an emergency disclaimer banner.

---

## 🌊 Doctor-Owned Automatic Wave Scheduling (Arrival Windows over Fixed Slots)

Medrella prevents clinic lobby congestion and patient waiting room anxiety through doctor-owned arrival wave scheduling (`src/lib/waves.ts`):

- **Core Product Invariant:** Consultation slots decide **when the doctor sees** each patient (fixed length, one patient each). **Nothing about waves changes slot times or consultation order.** Waves only decide **when the patient should arrive**.
- **Live Queue Separation:** The doctor calls a patient only in the Live Queue (`Start Consultation`). Waves never start or reorder consultations.
- **Admin Boundary:** The Admin portal is strictly doctor validation/approval and platform oversight. No wave management features exist for admins.
- **Doctor Preferences:** The doctor sets three defaults once:
  1. `waveWindowMinutes` (default: 30 min): consultation chunking window.
  2. `waveCapacity` (default: 2–3 patients): maximum patients per arrival wave.
  3. `arrivalBufferMinutes` (default: 15 min): arrival buffer before the first consultation slot in the wave.
  4. `autoPublishWaves` (default: false): whether generated waves are published immediately or kept as drafts.

### 📐 Realistic Worked Example (15-Minute Slots)

Consider a doctor with 15-minute consultation slots on a morning schedule:
- **Slots:**
  - Patient 1: 10:00 AM – 10:15 AM
  - Patient 2: 10:15 AM – 10:30 AM
  - Patient 3: 10:30 AM – 10:45 AM
- **Doctor Preferences:** `windowMinutes = 30`, `capacity = 2`, `buffer = 15`.

**Algorithm Execution:**
1. **Chunk 1:** Covers `[10:00, 10:30)`. Captures Patient 1 (10:00) and Patient 2 (10:15). Chunk size = 2 (meets capacity 2).
   - First slot in group: `10:00 AM`.
   - Arrival Window: `10:00 - 15 min = 09:45 AM` to `10:00 AM`.
   - **Wave 1 Arrival Window:** `09:45 AM - 10:00 AM (IST)`.
   - Patients assigned: Patient 1 & Patient 2.
2. **Chunk 2:** Covers `[10:30, 11:00)`. Captures Patient 3 (10:30). Chunk size = 1 (within capacity 2).
   - First slot in group: `10:30 AM`.
   - Arrival Window: `10:30 - 15 min = 10:15 AM` to `10:30 AM`.
   - **Wave 2 Arrival Window:** `10:15 AM - 10:30 AM (IST)`.
   - Patients assigned: Patient 3.

> **Key Invariant:** Consultation slots remain strictly **10:00 AM, 10:15 AM, and 10:30 AM**. Only the patient's requested arrival window is communicated (`"Arrive between 09:45 AM and 10:00 AM (IST). Your consultation slot is 10:00 AM."`).

### 🛡️ System Invariants & Rules

1. **Overlap Validation Rule:** Overlap validation applies to **MANUAL** wave creation only (preventing doctors from scheduling contradictory manual arrival windows). **Generated waves may legitimately overlap** when the arrival buffer exceeds the gap between groups' first slots and are never rejected or altered.
2. **Draft Visibility Invariant:** Patient appointment cards, notifications, and queue badges show an arrival window **ONLY** when `wave.status = PUBLISHED`. `DRAFT` waves are strictly invisible to patients. Re-generating waves deletes existing `DRAFT` waves (setting appointments' `waveId = null`), and `PUBLISHED` waves are permanent and never deleted or altered.
3. **Past-Window Clamping & Expired Arrival Rule:**
   - If `arrivalStart < now`, the window start is clamped to `now`.
   - If the arrival window has already passed (`arrivalEnd <= now`):
     - Already `CHECKED_IN` (or `IN_CONSULTATION`/`COMPLETED`) patients are **NOT unassigned**: they remain in their wave and count as arrived.
     - Only `CONFIRMED` (not yet arrived) patients whose window has passed go to "unassigned" with the specific reason `"Arrival window expired"`.
4. **Race-Safe Concurrency & Idempotency:** Wave generation locks the doctor row (`SELECT id FROM doctors WHERE id = $1 FOR UPDATE`) inside a short transaction (`{ maxWait: 10000, timeout: 20000 }`), guaranteeing that concurrent clicks produce no duplicate draft waves and leave published waves untouched.
5. **Deduplicated In-App Notifications:** When published, patients receive a `WAVE_PUBLISHED` notification. If an appointment is moved to another wave, a notification is sent for the new window only. Notifications are deduplicated by target wave ID/href.

### ⚠️ System Limitations

- **Trigger Model:** Waves are generated on-demand when the doctor clicks **Generate Drafts** or **Generate & Publish** in `/doctor/waves`. Nothing runs on a background cron or automatic schedule.
- **Single-Doctor Scope:** Waves are strictly doctor-owned. There is no cross-doctor wave pooling or multi-practitioner coordination.
- **In-App Notifications Only:** Notifications are delivered via Medrella's in-app notification center. SMS, WhatsApp, and email delivery channels are not included.

---

## 🛡️ Doctor Absence & Slot Restoration Rule (`blockedByTimeOffId`)

When a doctor logs time off via `/doctor/time-off`:
1. All slots within `[startAt, endAt)` are marked `BLOCKED`.
2. Each blocked slot records `blockedByTimeOffId = doctorTimeOff.id`.
3. Confirmed appointments in that window are flagged `disruptedAt = now` with the reason, and affected patients receive immediate `DOCTOR_ABSENCE` notifications with free cancellation/rescheduling.
4. **Slot Restoration Rule:** When an absence is deleted, the system restores to `AVAILABLE` **ONLY** slots where `blockedByTimeOffId = doctorTimeOff.id` that have no active appointment.
5. **Manual Block Preservation:** Any slots manually blocked by the doctor (`blockedByTimeOffId == null`) are **never touched or automatically unblocked**.

---

## 🔄 Dynamic Rescheduling & Automated Waitlist

- **Patient Self-Service Reschedule (`/book/reschedule/[appointmentId]`):** Patients can reschedule up to **2 times**, at least **2 hours before start** (waived if disrupted by doctor absence).
- **Atomic Slot Swap:** Inside a single database transaction, the target slot is claimed (`BOOKED`), the previous slot is freed (`releaseSlot`), and the appointment is moved to `PENDING` with `rescheduleCount` incremented.
- **Automated Waitlist:** When all slots for a doctor are booked, patients can join the waitlist with a target date range.
- **Automated Release Trigger:** Whenever an active appointment is cancelled or rescheduled, `releaseSlot` checks `waitlist_entries` and dispatches `SLOT_AVAILABLE` notifications to waiting patients.

---

## 🔔 In-App Notification Engine

The system supports real-time notifications with unread counts and a dedicated notification center (`/notifications`):

| Notification Type | Trigger Point | Description |
|---|---|---|
| `APPOINTMENT_CONFIRMED` | Doctor confirms booking | Patient informed consultation is approved. |
| `APPOINTMENT_CANCELLED` | Patient / Doctor cancels | Counterpart informed consultation is cancelled. |
| `APPOINTMENT_RESCHEDULED` | Patient / Doctor reschedules | Counterpart informed of updated slot time. |
| `DOCTOR_ABSENCE` | Doctor schedules time off | Patients notified of disruption with free reschedule link. |
| `SLOT_AVAILABLE` | `releaseSlot` finds waitlist match | Waitlisted patients alerted that a slot opened up. |
| `WAVE_PUBLISHED` | Admin publishes arrival wave | Patient notified of their specific arrival window. |
| `QUEUE_DELAY` | `startConsultation` / `endConsultation` | Triggered only if estimated delay exceeds 20 minutes (debounced via `delayNotifiedAt`, once per day). |

---

## 🏷️ Clinical Visit Streams

Consultations are categorized into three distinct clinical streams:
- `NEW_CONSULTATION`: First-time clinical evaluation (Patient selectable).
- `FOLLOW_UP`: Ongoing treatment or lab review (Patient selectable).
- `PRIORITY`: Clinically expedited review (Strictly restricted to Doctor and Admin; enforced on the server via `canAssignStream`).

---

## ⚠️ Known Limitations

1. **In-App Notifications Only:** Notifications are persisted to PostgreSQL and displayed via the navbar bell and `/notifications`. SMS and external email dispatch are omitted in Phase 5.
2. **Polling-Based Client Updates:** Live queue and appointment estimates auto-refresh on a 30-second polling interval (`useRouter().refresh()`), rather than WebSockets or Server-Sent Events.
3. **No Emergency Triage:** Medrella is designed strictly for elective and non-emergency outpatient consultations. All queue views display an emergency disclaimer directing acute emergencies to local hospital emergency lines.

---

## 🧪 Verification & Concurrency Test Scripts

Medrella includes both unit test suites and live database concurrency test scripts:

```bash
# 1. Run unit test suites (node:test via tsx)
npm run test

# 2. Run TypeScript strict typecheck
npm run typecheck

# 3. Run ESLint checks
npm run lint

# 4. Verify Zero-Credential Production Build
npm run build

# 5. Run Live Database Booking Concurrency Test
npx tsx scripts/test-booking.ts

# 6. Run Live Database Queue & Reschedule Race Condition Test
npx tsx scripts/test-queue-concurrency.ts
```

---

## 🚀 Production Deployment & Neon Migration Guide

To apply database migrations to Neon and deploy to Vercel:

### 1. Apply Migration to Neon Database
Ensure `DATABASE_URL` (pooled) and `DIRECT_URL` (non-pooled) are configured in your active environment, then run:

```bash
npm run db:deploy
```

This applies migration `20261029000000_live_queue_waves_scheduling` which:
- Adds enum types `VisitStream`, `WaveStatus`, and `NotificationType`.
- Extends enum `AppointmentStatus` with `CHECKED_IN` and `IN_CONSULTATION`.
- Adds tables `waves`, `doctor_time_off`, `notifications`, and `waitlist_entries`.
- Preserves the partial unique index `appointments_availability_id_active_unique`.
- Enforces check constraints `waves_check_end_after_start` and `doctor_time_off_check_end_after_start`.

### 2. Verify Database State
Run the concurrency verification script to confirm database connectivity, schema integrity, and the partial unique index:

```bash
npx tsx scripts/test-booking.ts
npx tsx scripts/test-queue-concurrency.ts
```

### 3. Deploy to Vercel
Deploy your branch or push to production:
```bash
vercel --prod
```
Verify that the following environment variables are set in your Vercel Project Settings:
- `DATABASE_URL`
- `DIRECT_URL`
- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`