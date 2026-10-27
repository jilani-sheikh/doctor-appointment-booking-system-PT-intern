import {
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "@auth/core/adapters";

/**
 * Auth.js Users Table
 * Designed according to official @auth/drizzle-adapter specs.
 * Uses UUID strings for compatibility with modern OAuth providers and Auth.js.
 * Can be extended in subsequent phases with `role`, `password_hash`, `created_at`,
 * and relationships to `patients` and `doctors`.
 */
export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

/**
 * Auth.js Accounts Table
 * Stores linked OAuth provider credentials (e.g. Google).
 */
export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ]
);

/**
 * Auth.js Sessions Table
 * Required by the adapter schema specification.
 * (Note: Medrella uses JWT session strategy for performance, but this table is defined
 * to satisfy the full Auth.js adapter contract).
 */
export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

/**
 * Auth.js Verification Tokens Table
 * Stores verification tokens (e.g., magic links or email verification).
 */
export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ]
);
