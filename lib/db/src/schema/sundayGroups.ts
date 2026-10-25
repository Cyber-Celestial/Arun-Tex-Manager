import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const sundayGroupsTable = pgTable("sunday_groups", {
  groupId: serial("group_id").primaryKey(),
  name: text("name").notNull().unique(),
});

export type SundayGroup = typeof sundayGroupsTable.$inferSelect;
export type NewSundayGroup = typeof sundayGroupsTable.$inferInsert;
