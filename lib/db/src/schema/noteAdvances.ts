import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { money } from "./columns";
import { employeesTable } from "./employees";

export const noteAdvanceStatuses = ["Active", "Paid Off"] as const;
export type NoteAdvanceStatus = (typeof noteAdvanceStatuses)[number];

export const noteAdvancesTable = pgTable(
  "note_advances",
  {
    noteAdvanceId: serial("note_advance_id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.employeeId, { onDelete: "cascade" }),
    totalAmount: money("total_amount").notNull(),
    remainingBalance: money("remaining_balance").notNull(),
    monthlyRepayment: money("monthly_repayment").notNull(),
    issueDate: date("issue_date").notNull(),
    expectedCompletionDate: date("expected_completion_date"),
    status: text("status").$type<NoteAdvanceStatus>().notNull().default("Active"),
  },
  (table) => [
    check("note_advances_status_check", sql`${table.status} in ('Active', 'Paid Off')`),
  ],
);

export type NoteAdvance = typeof noteAdvancesTable.$inferSelect;
export type NewNoteAdvance = typeof noteAdvancesTable.$inferInsert;
