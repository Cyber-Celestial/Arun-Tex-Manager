type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const gst = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const privatePath = /^\/objects\/uploads\/[a-f0-9-]{36}$/i;
const irn = /^[a-f0-9]{64}$/i;
const eway = /^\d{12}$/;

export function validateDispatchState(data: JsonObject, previous?: JsonObject): string | null {
  if (!Array.isArray(data.invoices)) return 'Dispatch data must contain an invoices list.';
  const seen = new Set<string>();
  for (const value of data.invoices) {
    if (!object(value)) return 'A dispatch invoice is not valid.';
    const key = String(value.invoiceNumber ?? '').trim().toUpperCase();
    if (key && seen.has(key)) return 'An invoice with this number already exists.';
    if (key) seen.add(key);
    const prior = Array.isArray(previous?.invoices) ? previous.invoices.find(v => object(v) &&
      ((v.invoicePdfObjectPath && v.invoicePdfObjectPath === value.invoicePdfObjectPath) ||
       String(v.invoiceNumber).toUpperCase() === key)) : undefined;
    if (object(prior) && prior.ewayMovementBlocked === true &&
        (!value.invoicePdfObjectPath || prior.invoicePdfObjectPath === value.invoicePdfObjectPath) &&
        (value.ewayMovementBlocked !== true || value.ewayMovementWarning !== prior.ewayMovementWarning))
      return 'The original PDF records invalid movement. Upload a replacement document before removing that warning.';
    const movementBlocked = value.ewayMovementBlocked === true ||
      /not\s+valid\s+for\s+movement|Part[\s-]*B.*not\s+entered/i.test(String(value.ewayMovementWarning ?? ''));
    if (movementBlocked && (value.eWayDone === true || value.status === 'Completed'))
      return 'This PDF says movement is not valid / Part B is missing. Replace it with a completed document before confirming E-Way compliance.';
    if (value.invoiceMetadata !== undefined) {
      const m = value.invoiceMetadata;
      if (!object(m) || !object(m.bill_to) || !object(m.ship_to))
        return 'Imported billing and shipping details must be structured objects.';
      if (!String(value.invoiceNumber ?? '').trim() || !String(value.customerName ?? '').trim())
        return 'Invoice number and customer name are required.';
      const date = String(value.date ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) ||
        new Date(date).toISOString().slice(0,10) !== date) return 'Enter a valid invoice date.';
      if (!String(m.ship_to.address ?? '').trim()) return 'Confirm the shipping address.';
      for (const name of ['bill_to', 'ship_to'] as const) {
        const party = m[name] as JsonObject;
        for (const v of Object.values(party)) {
          if (v !== null && (typeof v !== 'string' || v.length > 4000)) return 'Party fields must be text no longer than 4,000 characters.';
        }
        if (party.gstin && !gst.test(String(party.gstin))) return 'Customer/ship-to GSTIN format is invalid.';
        if (party.pincode && !/^[1-9]\d{5}$/.test(String(party.pincode))) return 'Pincode must contain six digits.';
        if (party.state_code && !/^\d{2}$/.test(String(party.state_code))) return 'State code must contain two digits.';
      }
      if (m.customer_gst_number && !gst.test(String(m.customer_gst_number))) return 'Customer GSTIN format is invalid.';
      if (value.customerGstin && !gst.test(String(value.customerGstin))) return 'Customer GSTIN format is invalid.';
      if ((m.irn_number && !irn.test(String(m.irn_number))) ||
          (value.eInvoiceIrn && !irn.test(String(value.eInvoiceIrn)))) return 'IRN must contain exactly 64 hexadecimal characters.';
      if ((m.eway_bill_number && !eway.test(String(m.eway_bill_number))) ||
          (value.eWayBillNumber && !eway.test(String(value.eWayBillNumber)))) return 'E-Way Bill number must contain exactly 12 digits.';
      if (m.ack_number && !/^\d{15}$/.test(String(m.ack_number))) return 'Acknowledgement number must contain 15 digits.';
      if (m.total !== null && (typeof m.total !== 'number' || !Number.isFinite(m.total) || m.total < 0))
        return 'Invoice total must be a valid non-negative number.';
      if (value.invoicePdfObjectPath && !privatePath.test(String(value.invoicePdfObjectPath))) return 'Invalid private invoice document reference.';
    }
    if (value.eWayDone === true && !eway.test(String(value.eWayBillNumber ?? '')))
      return 'Enter a 12-digit E-Way Bill number before confirming E-Way compliance.';
    if (value.eInvoiceDone === true && value.invoiceMetadata && !irn.test(String(value.eInvoiceIrn ?? '')))
      return 'Enter a 64-character IRN before confirming e-invoice compliance.';
    if (value.status !== 'Completed') continue;
    const ready = value.eInvoiceDone === true && value.eWayDone === true &&
      eway.test(String(value.eWayBillNumber ?? '')) && value.bundleDone === true &&
      ['lrNumber', 'lrPdfObjectPath', 'courierPdfObjectPath'].every(k => typeof value[k] === 'string' && String(value[k]).trim()) &&
      value.whatsappSent === true && value.courierSent === true && value.vastraCourierUpdated === true;
    if (!ready) return 'A dispatch invoice cannot be completed until every compliance step is done.';
  }
  return null;
}
