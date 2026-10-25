import { sql } from "drizzle-orm";
import { boolean, check, date, pgTable, text } from "drizzle-orm/pg-core";
import { b2cDailyBatchesTable } from "./b2cDailyBatches";
import { money } from "./columns";

export const b2cTransactionTypes = ["Invoice", "Return"] as const;
export type B2cTransactionType = (typeof b2cTransactionTypes)[number];

export const vastraPaymentModes = ["CASH", "CARD", "UPI", "SPLIT", "RETURN"] as const;
export type VastraPaymentMode = (typeof vastraPaymentModes)[number];

export const b2cTransactionsTable = pgTable(
  "b2c_transactions",
  {
    invoiceNumber: text("invoice_number").primaryKey(),
    date: date("date")
      .notNull()
      .references(() => b2cDailyBatchesTable.date, { onDelete: "cascade" }),
    totalInvoiceAmount: money("total_invoice_amount").notNull(),
    type: text("type").$type<B2cTransactionType>().notNull(),
    vastraAgentNameMode: text("vastra_agent_name_mode").$type<VastraPaymentMode>(),
    cashAmount: money("cash_amount").notNull().default(0),
    upiAmount: money("upi_amount").notNull().default(0),
    cardAmount: money("card_amount").notNull().default(0),
    bankVerified: boolean("bank_verified").notNull().default(false),
  },
  (table) => [
    check("b2c_transactions_type_check", sql`${table.type} in ('Invoice', 'Return')`),
    check(
      "b2c_transactions_mode_check",
      sql`${table.vastraAgentNameMode} in ('CASH', 'CARD', 'UPI', 'SPLIT', 'RETURN')`,
    ),
  ],
);

export type B2cTransaction = typeof b2cTransactionsTable.$inferSelect;
export type NewB2cTransaction = typeof b2cTransactionsTable.$inferInsert;
