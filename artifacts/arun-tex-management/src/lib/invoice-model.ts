export type Party = {
  name: string | null; address: string | null; city: string | null;
  state: string | null; state_code: string | null; pincode: string | null;
  phone: string | null; gstin: string | null;
};
export type InvoiceMetadata = {
  invoice_number: string | null; invoice_date: string | null;
  customer_name: string | null; customer_gst_number: string | null;
  bill_to: Party; ship_to: Party;
  lr_number: string | null; courier_number: string | null;
  eway_bill_number: string | null; irn_number: string | null; ack_number: string | null;
  total: number | null; transporter: string | null;
  delivery_challan: string | null; bale_reference: string | null;
};
export type InvoiceReadResult = {
  fields: InvoiceMetadata; warnings: string[]; movementBlocked: boolean;
  movementWarning: string | null; sources: Record<string, string>;
  timing: { pdfMs: number; parseMs: number; pages: number };
};
export const emptyParty = (): Party => ({
  name: null, address: null, city: null, state: null, state_code: null,
  pincode: null, phone: null, gstin: null,
});
export const emptyInvoice = (): InvoiceMetadata => ({
  invoice_number: null, invoice_date: null, customer_name: null, customer_gst_number: null,
  bill_to: emptyParty(), ship_to: emptyParty(), lr_number: null, courier_number: null,
  eway_bill_number: null, irn_number: null, ack_number: null, total: null,
  transporter: null, delivery_challan: null, bale_reference: null,
});
export const cleanValue = (value: string | null | undefined): string | null => {
  const cleaned = value?.replace(/\s+/g, ' ').trim().replace(/^[:\s]+|[:\s]+$/g, '') || '';
  return !cleaned || /^[\s\-:./]*$/.test(cleaned) ? null : cleaned;
};
export function normalizeInvoice(raw: InvoiceMetadata): InvoiceMetadata {
  const f = structuredClone(raw);
  for (const key of Object.keys(f) as (keyof InvoiceMetadata)[]) {
    if (key === 'bill_to' || key === 'ship_to') {
      for (const part of Object.keys(f[key]) as (keyof Party)[]) f[key][part] = cleanValue(f[key][part]);
    } else if (key !== 'total') (f as Record<string, unknown>)[key] = cleanValue(f[key]);
  }
  return f;
}
export function invoiceErrors(raw: InvoiceMetadata): string[] {
  const f = normalizeInvoice(raw);
  const errors: string[] = [];
  if (!f.invoice_number?.trim()) errors.push('Invoice number is required.');
  if (!f.customer_name?.trim()) errors.push('Customer name is required.');
  if (!f.ship_to.address?.trim()) errors.push('Confirm the shipping address.');
  if (!f.invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(f.invoice_date) ||
      Number.isNaN(Date.parse(f.invoice_date)) ||
      new Date(f.invoice_date).toISOString().slice(0, 10) !== f.invoice_date)
    errors.push('Enter a valid invoice date.');
  if (f.irn_number && !/^[a-f0-9]{64}$/i.test(f.irn_number)) errors.push('IRN must contain 64 hexadecimal characters.');
  if (f.eway_bill_number && !/^\d{12}$/.test(f.eway_bill_number)) errors.push('E-Way Bill must contain 12 digits.');
  if (f.ack_number && !/^\d{15}$/.test(f.ack_number)) errors.push('Acknowledgement number must contain 15 digits.');
  for (const [name, party] of [['Billing', f.bill_to], ['Shipping', f.ship_to]] as const) {
    if (party.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(party.gstin))
      errors.push(`${name} GSTIN format is invalid.`);
    if (party.pincode && !/^[1-9]\d{5}$/.test(party.pincode)) errors.push(`${name} pincode must contain six digits.`);
    if (party.state_code && !/^\d{2}$/.test(party.state_code)) errors.push(`${name} state code must contain two digits.`);
  }
  if (f.customer_gst_number && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.customer_gst_number))
    errors.push('Customer GSTIN format is invalid.');
  if (f.total !== null && (!Number.isFinite(f.total) || f.total < 0)) errors.push('Total must be a non-negative number.');
  return errors;
}
export function toDispatchInvoice(fields: InvoiceMetadata): Record<string, unknown> {
  const f = normalizeInvoice(fields);
  return {
    invoiceMetadata: f, invoiceNumber: f.invoice_number, date: f.invoice_date,
    customerName: f.customer_name, customerGstin: f.customer_gst_number,
    billToDetails: [f.bill_to.name, f.bill_to.address].filter(Boolean).join('\n'),
    shipToDetails: [f.ship_to.name, f.ship_to.address].filter(Boolean).join('\n'),
    customerPhone: f.bill_to.phone, shipToPhone: f.ship_to.phone, shipToGstin: f.ship_to.gstin,
    eInvoiceIrn: f.irn_number, eWayBillNumber: f.eway_bill_number, ackNumber: f.ack_number,
    lrNumber: f.lr_number, courierNumber: f.courier_number, totalInvoiceAmount: f.total,
  };
}
export function fromDispatchInvoice(record?: Record<string, any>): InvoiceMetadata {
  if (record?.invoiceMetadata) return {
    ...emptyInvoice(), ...record.invoiceMetadata,
    bill_to: { ...emptyParty(), ...record.invoiceMetadata.bill_to },
    ship_to: { ...emptyParty(), ...record.invoiceMetadata.ship_to },
    lr_number: record.lrNumber || null, eway_bill_number: record.eWayBillNumber || null,
  };
  const f = emptyInvoice();
  if (!record) return f;
  return { ...f, invoice_number: record.invoiceNumber || null, customer_name: record.customerName || null,
    invoice_date: record.date?.slice(0, 10) || null, customer_gst_number: record.customerGstin || null,
    bill_to: { ...f.bill_to, name: record.customerName || null, address: record.billToDetails || null },
    ship_to: { ...f.ship_to, address: record.shipToDetails || null },
    eway_bill_number: record.eWayBillNumber || null, irn_number: record.eInvoiceIrn || null,
    lr_number: record.lrNumber || null, courier_number: record.courierNumber || null };
}
