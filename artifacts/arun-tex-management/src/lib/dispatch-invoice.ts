export type InvoiceFields = {
  invoiceNumber: string;
  customerName: string;
  date: string;
  shipToDetails: string;
  billToDetails: string;
  customerGstin: string;
  customerPhone: string;
  shipToGstin: string;
  shipToPhone: string;
  eInvoiceIrn: string;
  eWayBillNumber: string;
};

export const emptyInvoice = (): InvoiceFields => ({
  invoiceNumber: '', customerName: '', date: '', shipToDetails: '',
  billToDetails: '', customerGstin: '', customerPhone: '', shipToGstin: '', shipToPhone: '', eInvoiceIrn: '', eWayBillNumber: '',
});

export const validIrn = (value: unknown) => /^[a-f0-9]{64}$/i.test(String(value ?? '').trim());
export const validEway = (value: unknown) => /^\d{12}$/.test(String(value ?? '').trim());

export function invoiceErrors(invoice: Partial<InvoiceFields>) {
  const errors: string[] = [];
  if (!invoice.invoiceNumber?.trim()) errors.push('Invoice number is required.');
  if (!invoice.customerName?.trim()) errors.push('Customer name is required.');
  if (!invoice.shipToDetails?.trim()) errors.push('Confirm the delivery address.');
  if (!invoice.date || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.date) ||
      Number.isNaN(Date.parse(invoice.date)) || new Date(invoice.date).toISOString().slice(0, 10) !== invoice.date)
    errors.push('Enter a valid invoice date.');
  if (invoice.eInvoiceIrn && !validIrn(invoice.eInvoiceIrn)) errors.push('IRN must contain exactly 64 hexadecimal characters.');
  if (invoice.eWayBillNumber && !validEway(invoice.eWayBillNumber)) errors.push('E-way bill number must contain exactly 12 digits.');
  for (const key of ['customerGstin','shipToGstin'] as const)
    if (invoice[key] && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(invoice[key]))
      errors.push(`${key==='customerGstin'?'Customer':'Ship-to'} GSTIN format is invalid.`);
  return errors;
}

// Format validation only: no government registration or cancellation status lookup.
export function dispatchComplete(invoice: Record<string, unknown>) {
  return !invoiceErrors(invoice).length && validIrn(invoice.eInvoiceIrn) && validEway(invoice.eWayBillNumber) &&
    ['eInvoiceDone', 'eWayDone', 'bundleDone', 'whatsappSent', 'courierSent', 'vastraCourierUpdated'].every(k => invoice[k] === true) &&
    ['lrNumber', 'lrPdfObjectPath', 'courierPdfObjectPath'].every(k => typeof invoice[k] === 'string' && String(invoice[k]).trim().length > 0);
}

function invoiceDate(value: string) {
  const named = value.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (named) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[1].slice(0,3).toLowerCase()) + 1;
    return `${named[3]}-${String(month).padStart(2,'0')}-${named[2].padStart(2,'0')}`;
  }
  const match = value.match(/\b(?:(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[-/ .]([A-Za-z]{3,9}|\d{1,2})[-/ .](\d{4}|\d{2}))\b/);
  if (!match) return '';
  if (match[1]) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const month = /^\d+$/.test(match[5]) ? Number(match[5]) : months.indexOf(match[5].slice(0,3).toLowerCase()) + 1;
  return `${match[6].length === 2 ? '20' : ''}${match[6]}-${String(month).padStart(2,'0')}-${match[4].padStart(2,'0')}`;
}

export function extractInvoice(text: string): { fields: InvoiceFields; warnings: string[] } {
  const fields = emptyInvoice();
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const normalized = lines.join('\n');
  const capture = (pattern: RegExp) => normalized.match(pattern)?.[1]?.trim() || '';
  fields.invoiceNumber = capture(/^(?:tax\s+)?invoice\s*(?:number|no\.?|num|#)\s*[:.-]?\s*([A-Z0-9][A-Z0-9/-]*)/im);
  fields.date = invoiceDate(capture(/(?:invoice\s*date|issue\s*date|dated)\s*[:.-]?\s*([^\n]+)/i));
  // IDs may wrap across PDF text lines. Do not strip arbitrary punctuation.
  const irn = normalized.match(/\b(?:IRN|invoice\s+reference\s+(?:number|no\.?))\s*[:.-]?\s*((?:[a-f0-9][ \t\n]*){64})(?![a-f0-9])/i);
  fields.eInvoiceIrn = irn?.[1].replace(/\s/g, '').toLowerCase() || '';
  fields.eWayBillNumber = capture(/(?:e[-\s]*way\s*(?:bill)?\s*(?:number|no\.?|num|#)?|EWB\s*(?:number|no\.?))\s*[:.-]?\s*((?:\d[ \t]*){12})(?!\d)/i).replace(/\s/g, '');
  const stop = /^(?:GSTIN|GST\s*(?:no|number)|PAN|place of|invoice|IRN|e[- ]?way|EWB|S\.?\s*No|HSN|description|quantity|total|contact|phone|mobile|email|dispatch|delivery note|payment|supplier\s*name)/i;
  function party(pattern: RegExp) {
    const index = lines.findIndex(l => pattern.test(l));
    if (index < 0) return [];
    const first = lines[index].replace(pattern, '').replace(/^\s*[:.-]\s*/, '').trim();
    const result = first ? [first] : [];
    for (let i = index + 1; i < lines.length && result.length < 6; i++) {
      if (stop.test(lines[i]) || /^(?:ship\s*to|bill\s*to|buyer|consignee|customer)/i.test(lines[i])) break;
      result.push(lines[i]);
    }
    return result;
  }
  const buyer = party(/^(?:bill\s*to|buyer(?:\s*\(bill\s*to\))?|customer(?:\s*name)?)\s*[:.-]?\s*/i);
  const ship = party(/^(?:ship\s*to|consignee(?:\s*\(ship\s*to\))?)\s*[:.-]?\s*/i);
  fields.customerName = (buyer[0] || ship[0] || '').replace(/^M\/S\s*[:.-]?\s*/i,'');
  fields.billToDetails = buyer.join('\n');
  fields.shipToDetails = ship.length ? ship.join('\n') : '';
  const buyerIndex = lines.findIndex(l => /^(?:bill\s*to|buyer|customer)/i.test(l));
  if (buyerIndex >= 0) {
    const buyerSection = lines.slice(buyerIndex).join('\n').split(/(?:ship\s*to|consignee|supplier\s*name|description|HSN)/i)[0];
    fields.customerGstin = buyerSection.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/)?.[0] || '';
    fields.customerPhone = buyerSection.match(/(?:phone|mobile|contact)(?:\s*(?:no\.?|number))?\s*[:.-]?\s*(\+?\d[\d ()-]{8,18}\d)/i)?.[1]?.trim() || '';
  }
  const shipIndex = lines.findIndex(l => /^(?:ship\s*to|consignee)/i.test(l));
  if (shipIndex >= 0) {
    const shipSection = lines.slice(shipIndex).join('\n').split(/(?:bill\s*to|buyer|supplier\s*name|description|HSN)/i)[0];
    fields.shipToGstin = shipSection.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/)?.[0] || '';
    fields.shipToPhone = shipSection.match(/(?:phone|mobile|contact)(?:\s*(?:no\.?|number))?\s*[:.-]?\s*(\+?\d[\d ()-]{8,18}\d)/i)?.[1]?.trim() || '';
  }
  const warnings = ['Review every extracted value against the original PDF. Side-by-side customer and delivery sections may need correction.'];
  if (!text.trim()) warnings.push('No readable text was found. This may be a scanned PDF; enter the fields manually.');
  for (const [key, label] of Object.entries({invoiceNumber:'Invoice number', date:'Invoice date', customerName:'Customer', shipToDetails:'Delivery address', eInvoiceIrn:'IRN', eWayBillNumber:'E-way bill number'})) {
    if (!fields[key as keyof InvoiceFields]) warnings.push(`${label} was not confidently found.`);
  }
  return { fields, warnings };
}
