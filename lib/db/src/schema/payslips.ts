import { sql } from "drizzle-orm";
import { check, integer, numeric, pgTable, serial, unique } from "drizzle-orm/pg-core";
import { money } from "./columns";
import { employeesTable } from "./employees";
import { payrollRunsTable } from "./payrollRuns";

export const payslipsTable = pgTable(
  "payslips",
  {
    payslipId: serial("payslip_id").primaryKey(),
    payrollRunId: integer("payroll_run_id")
      .notNull()
      .references(() => payrollRunsTable.payrollRunId, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.employeeId, { onDelete: "restrict" }),
    baseSalary: money("base_salary").notNull(),
    esiAmount: money("esi_amount").notNull(),
    pfAmount: money("pf_amount").notNull(),
    transportAllowance: money("transport_allowance").notNull(),
    unpaidAbsenceDays: numeric("unpaid_absence_days", { precision: 4, scale: 1, mode: "number" })
      .notNull()
      .default(0),
    absenceDeduction: money("absence_deduction").notNull().default(0),
    weekendPenaltyCount: integer("weekend_penalty_count").notNull().default(0),
    weekendPenaltyDeduction: money("weekend_penalty_deduction").notNull().default(0),
    salaryAdvanceDeduction: money("salary_advance_deduction").notNull().default(0),
    noteAdvanceDeduction: money("note_advance_deduction").notNull().default(0),
    netSalary: money("net_salary").notNull(),
  },
  (table) => [
    unique("payslips_run_employee_unique").on(table.payrollRunId, table.employeeId),
    check("payslips_net_salary_non_negative_check", sql`${table.netSalary} >= 0`),
  ],
);

export type Payslip = typeof payslipsTable.$inferSelect;
export type NewPayslip = typeof payslipsTable.$inferInsert;
