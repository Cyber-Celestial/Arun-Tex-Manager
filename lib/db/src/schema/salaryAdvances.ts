import { date, integer, pgTable, serial } from "drizzle-orm/pg-core";
import { money } from "./columns";
import { employeesTable } from "./employees";

export const salaryAdvancesTable = pgTable("salary_advances", {
  salaryAdvanceId: serial("salary_advance_id").primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.employeeId, { onDelete: "cascade" }),
  amountIssued: money("amount_issued").notNull(),
  issueDate: date("issue_date").notNull(),
});

export type SalaryAdvance = typeof salaryAdvancesTable.$inferSelect;
export type NewSalaryAdvance = typeof salaryAdvancesTable.$inferInsert;
