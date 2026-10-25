import { cleanValue, emptyInvoice, emptyParty, type Party, type InvoiceReadResult } from './invoice-model';

export type PdfToken = { text: string; x: number; y: number; width: number; height: number };
export type PdfPage = { page: number; width: number; height: number; tokens: PdfToken[] };
const gstPattern = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i;

/** Baselines, not PDF stream order, determine rows; party zones are kept separate. */
export function textRows(tokens: PdfToken[]): string[] {
  const rows: { y: number; tokens: PdfToken[] }[] = [];
  for (const token of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = rows.at(-1);
    if (previous && Math.abs(previous.y - token.y) <= Math.max(2, Math.min(token.height * .25, 3)))
      previous.tokens.push(token);
    else rows.push({ y: token.y, tokens: [token] });
  }
  return rows.map(row => row.tokens.sort((a, b) => a.x - b.x).map(t => t.text).join(' ').trim()).filter(Boolean);
}

export function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  let year = 0, month = 0, day = 0;
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const named = value.match(/\b([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/i);
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const indian = value.match(/\b(\d{1,2})[-/ ](\d{1,2}|[a-z]{3,9})[-/ ](\d{4}|\d{2})\b/i);
  if (named) { year = +named[3]; month = months.indexOf(named[1].slice(0,3).toLowerCase()) + 1; day = +named[2]; }
  else if (iso) { year = +iso[1]; month = +iso[2]; day = +iso[3]; }
  else if (indian) {
    year = +indian[3] + (indian[3].length === 2 ? 2000 : 0);
    month = /^\d+$/.test(indian[2]) ? +indian[2] : months.indexOf(indian[2].slice(0,3).toLowerCase()) + 1;
    day = +indian[1];
  }
  if (!year || !month || !day) return null;
  const result = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return !Number.isNaN(Date.parse(result)) && new Date(result).toISOString().slice(0,10) === result ? result : null;
}

function partyFromRows(rows: string[]): Party {
  const party = emptyParty();
  let active: 'name' | 'address' | null = 'name';
  const pieces: Record<'name' | 'address', string[]> = { name: [], address: [] };
  for (const row of rows) {
    if (/^(?:bill\s*to|ship\s*to)\s*$/i.test(row)) continue;
    const name = row.match(/^(?:M\/S|Name|Buyer's\s*Name|Buyer(?:\s*Name)?|Customer(?:\s*Name)?)\s*[:.]?\s*(.*)$/i);
    const address = row.match(/^Address\s*:\s*(.*)$/i);
    if (name) { active = 'name'; if (cleanValue(name[1])) pieces.name.push(name[1]); continue; }
    if (address) { active = 'address'; if (cleanValue(address[1])) pieces.address.push(address[1]); continue; }
    const boundary = /^(?:Agency|Phone|Mobile|Contact|GST|City|State|Pin\s*code|Transport|Invoice|IRN|Ack|E[- ]?way|HSN|Sr\s*No|Description)\b/i.test(row);
    if (boundary) active = null;
    if (active) pieces[active].push(row);
    party.gstin ||= row.match(gstPattern)?.[0]?.toUpperCase() || null;
    if (/^(?:Phone|Mobile|Contact)/i.test(row)) {
      const raw = cleanValue(row.replace(/^(?:Phone|Mobile|Contact)\s*(?:No\.?|Number)?\s*[:.]?\s*/i, ''));
      party.phone = raw?.replace(/\s/g, '').replace(/^\+91-?/, '+91-') || null;
    }
    party.city ||= cleanValue(row.match(/\bCity\s*:\s*(.*?)(?=,\s*(?:State|Pincode)|$)/i)?.[1]);
    party.state ||= cleanValue(row.match(/\bState\s*:\s*(.*?)(?=,\s*Code|$)/i)?.[1]);
    party.state_code ||= cleanValue(row.match(/\bCode\s*:\s*(\d{2})\b/i)?.[1]);
    party.pincode ||= cleanValue(row.match(/\bPin\s*code\s*:\s*([1-9]\d{5})\b/i)?.[1]);
  }
  party.name = cleanValue(pieces.name.join(' '));
  party.address = cleanValue(pieces.address.join(' ').replace(/-\s+(?=\d)/g, '-').replace(/,\s*/g, ', '));
  party.pincode ||= party.address?.match(/\b[1-9]\d{5}\b/)?.[0] || null;
  party.state_code ||= party.gstin?.slice(0,2) || null;
  return party;
}

export function parseInvoicePages(pages: PdfPage[]): InvoiceReadResult {
  const start = performance.now();
  const fields = emptyInvoice();
  const warnings: string[] = [];
  const sources: Record<string, string> = {};
  const texts = pages.map(p => textRows(p.tokens).join('\n'));
  const full = texts.join('\n');
  const capture = (pattern: RegExp, text = full) => cleanValue(text.match(pattern)?.[1]);
  function assignParty(kind: 'bill_to' | 'ship_to', heading: RegExp) {
    for (const page of pages) {
      const anchor = page.tokens.find(t => heading.test(t.text.trim()));
      if (!anchor) continue;
      const nextHeading = page.tokens.filter(t => t.x > anchor.x + 15 &&
        (Math.abs(t.y - anchor.y) < 8 || (t.y < anchor.y && anchor.y - t.y < 170)) &&
        /^(?:Ship\s*To|Invoice\s*No|Date\b)/i.test(t.text.trim())).sort((a,b) => a.x - b.x)[0];
      const bottom = page.tokens.filter(t => t.y > anchor.y + 10 &&
        /^(?:Sr\.?\s*No|S\.?\s*No|Description|Item$|HSN)/i.test(t.text.trim())).sort((a,b) => a.y - b.y)[0]?.y ?? Math.min(page.height, anchor.y + 230);
      const tokens = page.tokens.filter(t => t.x >= anchor.x - 3 && t.x < (nextHeading?.x ?? page.width) - 3 &&
        t.y >= anchor.y - 3 && t.y < bottom - 3);
      fields[kind] = partyFromRows(textRows(tokens));
      sources[kind] = `Page ${page.page}, ${kind === 'bill_to' ? 'billing' : 'shipping'} column`;
      for (const [key,value] of Object.entries(fields[kind])) if (value) sources[`${kind}.${key}`] = sources[kind];
      return;
    }
  }
  assignParty('bill_to', /^(?:Bill\s*To|Buyer's\s*Name\s*:|Buyer\s*:|Customer\s*:)/i);
  assignParty('ship_to', /^Ship\s*To\b/i);
  if (!fields.ship_to.address && !fields.ship_to.name && !sources.ship_to) {
    fields.ship_to = { ...fields.bill_to };
    warnings.push('No separate Ship To block was found. Billing details were copied; confirm the delivery address.');
    sources.ship_to = 'Billing fallback — confirm manually';
    for (const [key,value] of Object.entries(fields.ship_to)) if (value) sources[`ship_to.${key}`] = sources.ship_to;
  }
  fields.customer_name = fields.bill_to.name;
  fields.customer_gst_number = fields.bill_to.gstin ||
    capture(new RegExp(`GSTIN[ \\t]+of[ \\t]+Recipient[ \\t:|]*(${gstPattern.source.replace(/\\b/g, '')})`, 'i'))?.toUpperCase() || null;
  const firstPage = pages[0];
  const invoiceAnchor = firstPage?.tokens.find(t => /^Invoice\s*(?:No|Number)\b/i.test(t.text));
  // Capture logistics in the metadata column only, so an empty LR cannot take
  // a nearby customer or table value.
  const metadata = invoiceAnchor
    ? textRows(firstPage.tokens.filter(t => t.x >= invoiceAnchor.x - 3 &&
        t.y >= invoiceAnchor.y - 3 && t.y < invoiceAnchor.y + 125)).join('\n')
    : texts[0] || '';
  const sameLine = (label: string) => capture(new RegExp(`(?:^|\\n)${label}[ \\t:]*([^\\n]*)`, 'i'), metadata);
  const numberPattern = /(?:Invoice[ \t]*(?:No\.?|Number)|Document[ \t]*No\.?)[ \t:]*([A-Z0-9/-]*\d[A-Z0-9/-]*)/gi;
  const numbers = [...full.matchAll(numberPattern)].map(m => m[1]);
  fields.invoice_number = numbers[0] || null;
  if (new Set(numbers).size > 1) warnings.push(`Conflicting invoice references: ${[...new Set(numbers)].join(', ')}. Confirm the correct invoice.`);
  fields.invoice_date = normalizeDate(capture(/(?:Issue[ \t]*Date|Invoice[ \t]*Date|Document[ \t]*Date)[ \t:]*([^\n]+)/i));
  // On e-invoices the invoice/date headings can sit above their values.
  if (!fields.invoice_number || !fields.invoice_date) {
    for (const page of pages) {
      const anchor = page.tokens.find(t => /^Invoice\s*(?:No\.?|Number)\s*:?\s*$/i.test(t.text));
      if (!anchor) continue;
      const below = page.tokens.filter(t => t.y > anchor.y + 3 && t.y < anchor.y + 23);
      fields.invoice_number ||= below.find(t => Math.abs(t.x - anchor.x) < 5 && /\d/.test(t.text))?.text || null;
      const dateHeading = page.tokens.find(t => /^Date\s*:?\s*$/i.test(t.text) && Math.abs(t.y - anchor.y) < 4);
      if (dateHeading) fields.invoice_date ||= normalizeDate(below.find(t => Math.abs(t.x - dateHeading.x) < 5)?.text || null);
    }
  }
  fields.irn_number = capture(/\bIRN[ \t:\n]*((?:[a-f0-9][ \t\n]*){64})(?![a-f0-9])/i)?.replace(/\s/g, '').toLowerCase() ||
    full.match(/\b[a-f0-9]{64}\b/i)?.[0]?.toLowerCase() || null;
  fields.ack_number = capture(/\bAck[ \t]*(?:No\.?|Number)?[ \t:]*([0-9]{15})\b/i);
  const eways = [...full.matchAll(/(?:E[- \t]*way[ \t]*Bill[ \t]*(?:No\.?|Number)?|Unique[ \t]*No\.?)[ \t:]*([0-9]{12})\b/gi)].map(m=>m[1]);
  fields.eway_bill_number = eways[0] || null;
  if (new Set(eways).size > 1) warnings.push(`Conflicting E-Way Bill numbers: ${[...new Set(eways)].join(', ')}.`);
  fields.lr_number = sameLine('LR\\.?[ \\t]*(?:No\\.?|Number)');
  fields.courier_number = sameLine('(?:Manual[ \\t]*Challan|Courier)[ \\t]*(?:No\\.?|Number)');
  fields.delivery_challan = sameLine('Delivery[ \\t]*Challan[ \\t]*(?:No\\.?|Number)');
  fields.bale_reference = sameLine('Bale[ \\t]*(?:No\\.?|Number)')?.replace(/^-\s*/, '') || null;
  fields.transporter = capture(/Transport[ \t]*Name[ \t:]*([^\n]+)/i,
    sources.bill_to && firstPage ? textRows(firstPage.tokens.filter(t =>
      t.x < (firstPage.tokens.find(t => /^Ship\s*To/i.test(t.text))?.x ?? firstPage.width))).join('\n') : full);
  const total = capture(/Grand[ \t]*Total[ \t:]*([\d,]+(?:\.\d{1,2})?)/i) ||
    capture(/Value[ \t]*of[ \t]*Goods[ \t:]*([\d,]+(?:\.\d{1,2})?)/i);
  fields.total = total ? Number(total.replace(/,/g,'')) : null;
  const dateCandidates = [...full.matchAll(/(?:Issue[ \t]*Date|Invoice[ \t]*Date|Document[ \t]*Date)[ \t:]*([^\n]+)/gi)]
    .map(m => normalizeDate(m[1])).filter(Boolean);
  if (new Set(dateCandidates).size > 1) warnings.push('The invoice and E-Way document dates differ. Confirm the invoice date.');
  const recipient = capture(new RegExp(`GSTIN[ \\t]+of[ \\t]+Recipient[ \\t:|]*(${gstPattern.source.replace(/\\b/g,'')})`, 'i'));
  if (recipient && fields.customer_gst_number && recipient.toUpperCase() !== fields.customer_gst_number)
    warnings.push('E-Way recipient GSTIN differs from the billing GSTIN.');
  const delivery = capture(/Place[ \t]*of[ \t]*Delivery[ \t:]*([^\n]+)/i);
  if (delivery && fields.ship_to.pincode && !delivery.includes(fields.ship_to.pincode))
    warnings.push(`E-Way delivery location (${delivery}) differs from invoice Ship To. Confirm the delivery details before dispatch.`);
  const movementWarning = full.match(/[^\n]*(?:Not[ \t]+Valid[ \t]+for[ \t]+Movement|Part[ \t-]*B[^\n]*not[ \t]+entered)[^\n]*/i)?.[0]?.trim() || null;
  if (movementWarning) warnings.push(`Movement blocked: ${movementWarning}`);
  for (const [key, label] of Object.entries({
    invoice_number: 'Invoice number', invoice_date: 'Invoice date', customer_name: 'Customer name',
    customer_gst_number: 'Customer GSTIN', irn_number: 'IRN', eway_bill_number: 'E-Way Bill', ack_number: 'Acknowledgement number',
  })) {
    if (!fields[key as keyof typeof fields]) warnings.push(`${label} was not found. Enter it manually if applicable.`);
    else sources[key] = 'Label-anchored PDF text (not government-verified)';
  }
  if (!fields.ship_to.address) warnings.push('Shipping address was not found. Confirm it manually.');
  if (!full.trim()) warnings.push('No readable text found. Image-only PDFs need manual entry; OCR is not run.');
  return { fields, warnings, sources, movementBlocked: Boolean(movementWarning), movementWarning,
    timing: { pdfMs: 0, parseMs: performance.now() - start, pages: pages.length } };
}
