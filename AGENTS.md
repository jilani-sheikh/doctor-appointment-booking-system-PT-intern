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
