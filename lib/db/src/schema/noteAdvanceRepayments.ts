import { sql } from "drizzle-orm";
import { check, date, foreignKey, integer, pgTable, serial, unique } from "drizzle-orm/pg-core";
import { money } from "./columns";
import { noteAdvancesTable } from "./noteAdvances";
import { payrollRunsTable } from "./payrollRuns";

export const noteAdvanceRepaymentsTable = pgTable(
  "note_advance_repayments",
  {
    repaymentId: serial("repayment_id").primaryKey(),
    noteAdvanceId: integer("note_advance_id").notNull(),
    payrollRunId: integer("payroll_run_id").notNull(),
    amount: money("amount").notNull(),
    repaymentDate: date("repayment_date").notNull(),
  },
  (table) => [
    foreignKey({
      name: "note_advance_repayments_note_advance_fk",
      columns: [table.noteAdvanceId],
      foreignColumns: [noteAdvancesTable.noteAdvanceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "note_advance_repayments_payroll_run_fk",
      columns: [table.payrollRunId],
      foreignColumns: [payrollRunsTable.payrollRunId],
    }).onDelete("restrict"),
    unique("note_advance_repayments_advance_run_unique").on(table.noteAdvanceId, table.payrollRunId),
    check("note_advance_repayments_amount_positive_check", sql`${table.amount} > 0`),
  ],
);

export type NoteAdvanceRepayment = typeof noteAdvanceRepaymentsTable.$inferSelect;
export type NewNoteAdvanceRepayment = typeof noteAdvanceRepaymentsTable.$inferInsert;
