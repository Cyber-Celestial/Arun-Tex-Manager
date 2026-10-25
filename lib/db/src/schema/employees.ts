import { sql } from "drizzle-orm";
import { check, numeric, pgTable, serial, text } from "drizzle-orm/pg-core";
import { money } from "./columns";

export const employeeStatuses = ["Active", "Inactive"] as const;
export type EmployeeStatus = (typeof employeeStatuses)[number];

export const employeesTable = pgTable(
  "employees",
  {
    employeeId: serial("employee_id").primaryKey(),
    name: text("name").notNull(),
    contactNumber: text("contact_number"),
    status: text("status").$type<EmployeeStatus>().notNull().default("Active"),
    baseSalary: money("base_salary").notNull().default(0),
    esiAmount: money("esi_amount").notNull().default(0),
    pfAmount: money("pf_amount").notNull().default(0),
    transportAllowance: money("transport_allowance").notNull().default(0),
    accumulatedPto: numeric("accumulated_pto", { precision: 5, scale: 2, mode: "number" })
      .notNull()
      .default(0),
  },
  (table) => [
    check("employees_status_check", sql`${table.status} in ('Active', 'Inactive')`),
  ],
);

export type Employee = typeof employeesTable.$inferSelect;
export type NewEmployee = typeof employeesTable.$inferInsert;
