const objectPath = /^\/objects\/uploads\/[a-f0-9-]{36}$/i;
const validIrn = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const validEway = (value: unknown) => typeof value === "string" && /^\d{12}$/.test(value);

export function validateDispatchState(data: Record<string, unknown>): string | null {
  if (!Array.isArray(data.invoices)) return "Dispatch data must contain an invoices list.";
  const references = new Set<string>();
  for (const value of data.invoices) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "A dispatch invoice is not valid.";
    const invoice = value as Record<string, unknown>;
    const reference = typeof invoice.invoiceNumber === "string" ? invoice.invoiceNumber.trim().toLowerCase() : "";
    if (!reference || references.has(reference)) return "Each dispatch invoice must have a unique invoice number.";
    references.add(reference);
    for (const field of ["invoicePdfObjectPath", "lrPdfObjectPath", "courierPdfObjectPath"]) {
      if (invoice[field] && (typeof invoice[field] !== "string" || !objectPath.test(String(invoice[field]))))
        return "Dispatch documents must be private uploaded PDF references.";
    }
    if (invoice.eInvoiceIrn && !validIrn(invoice.eInvoiceIrn)) return "E-invoice IRN must contain exactly 64 hexadecimal characters.";
    if (invoice.eWayBillNumber && !validEway(invoice.eWayBillNumber)) return "E-way bill number must contain exactly 12 digits.";
    if (invoice.eInvoiceDone === true && !validIrn(invoice.eInvoiceIrn)) return "A valid IRN is required before marking E-invoice done.";
    if (invoice.eWayDone === true && !validEway(invoice.eWayBillNumber)) return "A valid e-way bill number is required before marking E-way bill done.";
    if (invoice.status !== "Completed") continue;
    const date = typeof invoice.date === "string" ? invoice.date : "";
    const ready = validIrn(invoice.eInvoiceIrn) && validEway(invoice.eWayBillNumber) &&
      ["eInvoiceDone", "eWayDone", "bundleDone", "whatsappSent", "courierSent", "vastraCourierUpdated"].every(key => invoice[key] === true) &&
      ["customerName", "shipToDetails", "lrNumber", "lrPdfObjectPath", "courierPdfObjectPath"].every(key => typeof invoice[key] === "string" && String(invoice[key]).trim().length > 0) &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
    if (!ready) return "A dispatch invoice cannot be completed until every compliance step and delivery detail is done.";
  }
  return null;
}
