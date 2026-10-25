import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, serial, text, unique } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const sundayShiftTypes = ["Half-Day", "Full-Day", "Off"] as const;
export type SundayShiftType = (typeof sundayShiftTypes)[number];

export const rosterStatuses = ["Scheduled", "Completed", "Swapped"] as const;
export type RosterStatus = (typeof rosterStatuses)[number];

export const sundayRostersTable = pgTable(
  "sunday_rosters",
  {
    rosterId: serial("roster_id").primaryKey(),
    date: date("date").notNull(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.employeeId, { onDelete: "cascade" }),
    shiftType: text("shift_type").$type<SundayShiftType>().notNull(),
    status: text("status").$type<RosterStatus>().notNull().default("Scheduled"),
  },
  (table) => [
    unique("sunday_rosters_date_employee_unique").on(table.date, table.employeeId),
    check("sunday_rosters_shift_type_check", sql`${table.shiftType} in ('Half-Day', 'Full-Day', 'Off')`),
    check("sunday_rosters_status_check", sql`${table.status} in ('Scheduled', 'Completed', 'Swapped')`),
  ],
);

export type SundayRoster = typeof sundayRostersTable.$inferSelect;
export type NewSundayRoster = typeof sundayRostersTable.$inferInsert;
