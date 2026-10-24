import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type WorkspaceRole = "admin" | "billing" | "accounts" | "pending";

export const workspaceUsersTable = pgTable("workspace_users", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").$type<WorkspaceRole>().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const operationsStateTable = pgTable("operations_state", {
  id: text("id").primaryKey().default("main"),
  version: integer("version").notNull().default(1),
  b2c: jsonb("b2c")
    .notNull()
    .default(sql`'{"batches":[]}'::jsonb`),
  dispatch: jsonb("dispatch")
    .notNull()
    .default(sql`'{"invoices":[]}'::jsonb`),
  hr: jsonb("hr")
    .notNull()
    .default(
      sql`'{"employees":[],"attendance":[],"noteAdvances":[],"salaryAdvances":[],"sundayRosters":[],"diwaliFullDay":false}'::jsonb`,
    ),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type WorkspaceUser = typeof workspaceUsersTable.$inferSelect;
export type OperationsState = typeof operationsStateTable.$inferSelect;
