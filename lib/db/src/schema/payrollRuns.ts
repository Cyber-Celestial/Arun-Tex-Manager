import { sql } from "drizzle-orm";
import { check, date, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { workspaceUsersTable } from "./workspace";

export const payrollRunStatuses = ["Draft", "Processed"] as const;
export type PayrollRunStatus = (typeof payrollRunStatuses)[number];

export const payrollRunsTable = pgTable(
  "payroll_runs",
  {
    payrollRunId: serial("payroll_run_id").primaryKey(),
    month: date("month").notNull().unique(),
    status: text("status").$type<PayrollRunStatus>().notNull().default("Draft"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processedBy: text("processed_by").references(() => workspaceUsersTable.userId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("payroll_runs_status_check", sql`${table.status} in ('Draft', 'Processed')`),
    check("payroll_runs_month_first_day_check", sql`extract(day from ${table.month}) = 1`),
  ],
);

export type PayrollRun = typeof payrollRunsTable.$inferSelect;
export type NewPayrollRun = typeof payrollRunsTable.$inferInsert;
