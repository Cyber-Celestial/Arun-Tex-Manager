import { sql } from "drizzle-orm";
import { boolean, check, date, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const dispatchStatuses = ["Pending", "Completed"] as const;
export type DispatchStatus = (typeof dispatchStatuses)[number];

export const b2bDispatchTrackingTable = pgTable(
  "b2b_dispatch_tracking",
  {
    invoiceNumber: text("invoice_number").primaryKey(),
    date: date("date").notNull(),
    customerName: text("customer_name").notNull(),
    billToDetails: text("bill_to_details").notNull(),
    shipToDetails: text("ship_to_details").notNull(),
    eInvoiceDone: boolean("e_invoice_done").notNull().default(false),
    eWayDone: boolean("e_way_done").notNull().default(false),
    eWayBillNumber: text("e_way_bill_number"),
    bundleDone: boolean("bundle_done").notNull().default(false),
    lrNumber: text("lr_number"),
    lrPdfUrl: text("lr_pdf_url"),
    whatsappSent: boolean("whatsapp_sent").notNull().default(false),
    whatsappRecipient: text("whatsapp_recipient"),
    courierSent: boolean("courier_sent").notNull().default(false),
    vastraCourierUpdated: boolean("vastra_courier_updated").notNull().default(false),
    courierPdfUrl: text("courier_pdf_url"),
    status: text("status").$type<DispatchStatus>().notNull().default("Pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("b2b_dispatch_tracking_status_check", sql`${table.status} in ('Pending', 'Completed')`),
  ],
);

export type B2bDispatch = typeof b2bDispatchTrackingTable.$inferSelect;
export type NewB2bDispatch = typeof b2bDispatchTrackingTable.$inferInsert;
