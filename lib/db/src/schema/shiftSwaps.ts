import { boolean, date, integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const shiftSwapsTable = pgTable("shift_swaps", {
  swapId: serial("swap_id").primaryKey(),
  date: date("date").notNull(),
  requestingEmployeeId: integer("requesting_employee_id")
    .notNull()
    .references(() => employeesTable.employeeId, { onDelete: "cascade" }),
  coveringEmployeeId: integer("covering_employee_id")
    .notNull()
    .references(() => employeesTable.employeeId, { onDelete: "cascade" }),
  approvedByAdmin: boolean("approved_by_admin").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShiftSwap = typeof shiftSwapsTable.$inferSelect;
export type NewShiftSwap = typeof shiftSwapsTable.$inferInsert;
