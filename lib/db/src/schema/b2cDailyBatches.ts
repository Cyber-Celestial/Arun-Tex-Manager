import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, text } from "drizzle-orm/pg-core";
import { largeMoney } from "./columns";

export const batchStatuses = ["Pending", "Submitted"] as const;
export type BatchStatus = (typeof batchStatuses)[number];

const denomination = (name: string) => integer(name).notNull().default(0);

export const b2cDailyBatchesTable = pgTable(
  "b2c_daily_batches",
  {
    date: date("date").primaryKey(),
    totalCashSales: largeMoney("total_cash_sales").notNull().default(0),
    totalReturnsDeducted: largeMoney("total_returns_deducted").notNull().default(0),
    expectedCashNet: largeMoney("expected_cash_net").notNull().default(0),
    totalCardSales: largeMoney("total_card_sales").notNull().default(0),
    totalUpiSales: largeMoney("total_upi_sales").notNull().default(0),
    den500: denomination("den_500"),
    den200: denomination("den_200"),
    den100: denomination("den_100"),
    den50: denomination("den_50"),
    den20: denomination("den_20"),
    den10: denomination("den_10"),
    den5: denomination("den_5"),
    den2: denomination("den_2"),
    den1: denomination("den_1"),
    status: text("status").$type<BatchStatus>().notNull().default("Pending"),
  },
  (table) => [
    check("b2c_daily_batches_status_check", sql`${table.status} in ('Pending', 'Submitted')`),
  ],
);

export type B2cDailyBatch = typeof b2cDailyBatchesTable.$inferSelect;
export type NewB2cDailyBatch = typeof b2cDailyBatchesTable.$inferInsert;
