# Medrella — Doctor Appointment Booking System

Medrella is a full-stack doctor appointment scheduling web application connecting patients with healthcare professionals, managing doctor availability, and facilitating conflict-free consultation bookings.

Developed as part of the PearlThoughts internship programme.

---

## 📌 Project Overview

Medrella aims to provide a reliable, modern healthcare platform for managing users, patient profiles, doctor profiles, availability slots, and appointment workflows.

The application supports:
- **Phase 1 (Completed):** Secure project foundation, light healthcare design system, database migration infrastructure, and Google OAuth via Auth.js v5.
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
| **Drizzle ORM** | Type-safe ORM via `drizzle-orm/neon-http` & `drizzle-kit` | `0.45.4` / `0.31.11` |
| **Auth.js (NextAuth v5)** | Authentication with `@auth/drizzle-adapter` & Google OAuth | `5.0.0-beta.32` |
| **Zod** | Lazy runtime environment validation & schemas | `^3.24.2` |

---

## 🏗️ Architectural Decisions

### 1. JWT Session Strategy with Drizzle Adapter
Medrella configures Auth.js v5 with `session: { strategy: "jwt" }` combined with `@auth/drizzle-adapter`:
- **Account Persistence:** On successful Google OAuth sign-in, Auth.js creates and links the user and account records in Neon PostgreSQL via the Drizzle adapter.
- **Performance & Edge-Friendliness:** Instead of making blocking database round-trips on every page navigation to inspect a database session row, the session state is cryptographically signed and stored in a secure cookie.
- **Zero-Credential Builds:** Public landing pages render without database queries, keeping the application fast, resilient, and cost-effective.

### 2. Lazy Environment Validation
All environment variables are validated lazily on demand (`src/lib/env.ts`):
- `npm run build` and public landing page visits require zero environment variables.
- When an operation requiring credentials is run (e.g. initiating Google OAuth or running a database query), Zod validates the specific variable and provides an explicit, actionable error message naming the exact missing variable.

### 3. Server-Only Database Client
The Drizzle client (`src/lib/db/index.ts`) enforces `import "server-only"`. The HTTP client connects to Neon via `@neondatabase/serverless` only when SQL queries are dispatched, avoiding connection pools and preventing database credentials from ever leaking into client bundles.

---

## 📂 Repository Structure

```text
Doc_Booking_System/
├── .env.example              # Environment variables template
├── .gitignore                # Excludes secrets and build artifacts
├── README.md                 # Project documentation and setup guide
├── components.json           # shadcn/ui configuration
├── drizzle.config.ts         # Drizzle Kit configuration (loads .env.local)
├── next.config.ts            # Next.js configuration (remotePatterns for Google avatars)
├── package.json              # Project scripts and dependencies
├── postcss.config.mjs        # PostCSS configuration with Tailwind v4
├── tsconfig.json             # TypeScript configuration (@/* alias, strict mode)
├── docs/
│   ├── Doctor Appointment Booking System.png  # Entity Relationship Diagram
│   └── doctor-appointment-booking-system.dbml # Editable DBML source
├── drizzle/                  # Generated SQL migrations
│   └── 0000_panoramic_shocker.sql
└── src/
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
    │   │   └── auth.ts       # Server actions (signInAction, signOutAction)
    │   └── db/
    │       ├── index.ts      # Server-only lazy Neon HTTP Drizzle client
    │       └── schema.ts     # Auth.js Postgres adapter schema
    └── types/
        └── next-auth.d.ts    # Module augmentations for NextAuth Session and User
```

---

## ⚙️ Environment Variables

Create `.env.local` in the project root:

```env
# Neon PostgreSQL connection string (Serverless HTTP)
DATABASE_URL="postgresql://[user]:[password]@[neon-hostname]/[database]?sslmode=require"

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

### 2. Run Local Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the Medrella landing page.

### 3. Verification & Code Quality
```bash
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
3. Under **Dashboard > Connection Details**, select **Connection string** (choose **pooled** or **direct**; `@neondatabase/serverless` operates over HTTPS).
4. Copy the connection string into `.env.local` as `DATABASE_URL`.
5. Run the database migration script:
   ```bash
   npm run db:migrate
   ```
6. (Optional) Open Drizzle Studio to inspect database records:
   ```bash
   npm run db:studio
   ```

---

## 🔐 Google OAuth Configuration

1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project named **Medrella**.
3. Navigate to **APIs & Services > OAuth consent screen**:
   - User Type: **External**
   - App name: `Medrella`
   - User support email & Developer contact email: your email
   - Scopes: `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`
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
  - [x] Neon PostgreSQL + Drizzle ORM client & migration files generated.
  - [x] Auth.js v5 (NextAuth beta) with Google provider & Drizzle adapter.
  - [x] Lazy Zod environment validation (zero-credential build support).
  - [x] Responsive healthcare landing page with "Coming soon" placeholders.
- [ ] **Phase 2: User Profiles & Roles** (Patients, Doctors, Admin).
- [ ] **Phase 3: Doctor Availability Module** (Slots & calendar scheduling).
- [ ] **Phase 4: Appointment Booking & Lifecycle Management**.
- [ ] **Phase 5: Notifications & Payments**.