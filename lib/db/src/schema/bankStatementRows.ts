import { sql } from "drizzle-orm";
import { check, date, foreignKey, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { b2cTransactionsTable } from "./b2cTransactions";
import { money } from "./columns";

export const bankDepositModes = ["UPI", "CARD", "UNCLASSIFIED"] as const;
export type BankDepositMode = (typeof bankDepositModes)[number];

export const bankStatementRowsTable = pgTable(
  "bank_statement_rows",
  {
    bankRowId: serial("bank_row_id").primaryKey(),
    date: date("date").notNull(),
    narration: text("narration").notNull(),
    referenceNumber: text("reference_number"),
    depositAmount: money("deposit_amount").notNull(),
    mode: text("mode").$type<BankDepositMode>().notNull(),
    matchedInvoiceNumber: text("matched_invoice_number"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "bank_statement_rows_matched_invoice_fk",
      columns: [table.matchedInvoiceNumber],
      foreignColumns: [b2cTransactionsTable.invoiceNumber],
    }).onDelete("set null"),
    unique("bank_statement_rows_entry_unique").on(
      table.date,
      table.referenceNumber,
      table.depositAmount,
    ),
    check("bank_statement_rows_mode_check", sql`${table.mode} in ('UPI', 'CARD', 'UNCLASSIFIED')`),
  ],
);

export type BankStatementRow = typeof bankStatementRowsTable.$inferSelect;
export type NewBankStatementRow = typeof bankStatementRowsTable.$inferInsert;
