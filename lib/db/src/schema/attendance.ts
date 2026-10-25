import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, serial, text, unique } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const attendanceExceptionTypes = [
  "Informed Absent",
  "Uninformed Absent",
  "Paid Leave",
  "Half-Day",
  "On-Duty",
] as const;
export type AttendanceExceptionType = (typeof attendanceExceptionTypes)[number];

export const attendanceTable = pgTable(
  "attendance",
  {
    attendanceId: serial("attendance_id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.employeeId, { onDelete: "cascade" }),
    date: date("date").notNull(),
    exceptionType: text("exception_type").$type<AttendanceExceptionType>().notNull(),
  },
  (table) => [
    unique("attendance_employee_date_unique").on(table.employeeId, table.date),
    check(
      "attendance_exception_type_check",
      sql`${table.exceptionType} in ('Informed Absent', 'Uninformed Absent', 'Paid Leave', 'Half-Day', 'On-Duty')`,
    ),
  ],
);

export type Attendance = typeof attendanceTable.$inferSelect;
export type NewAttendance = typeof attendanceTable.$inferInsert;
