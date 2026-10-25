import * as XLSXModule from 'xlsx';
import { businessDate, localDateKey } from './pulse-data';

export type UploadKind = 'invoice' | 'return';
export type ParsedRow = {
  invoiceNumber: string; date: string; totalInvoiceAmount: number; type: 'Invoice' | 'Return';
  paymentMode: string; cashAmount: number; upiAmount: number; cardAmount: number; bankVerified: boolean;
};
export type SheetRows = { name: string; rows: Record<string, unknown>[] };

// The browser build exposes SSF as a named export; Node's CommonJS build only under default.
const SSF = (XLSXModule as any).SSF ?? (XLSXModule as any).default?.SSF;

export const normalizeColumn = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function readField(row: Record<string, unknown>, ...labels: string[]) {
  const candidates = labels.map(normalizeColumn);
  const entry = Object.entries(row).find(([key]) => {
    const normalized = normalizeColumn(key);
    return candidates.some(candidate => normalized === candidate || normalized.includes(candidate));
  });
  return entry?.[1];
}

export function dateCell(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return localDateKey(value);
  if (typeof value === 'number') {
    const parsed = SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(text)) return businessDate(text);
  const indian = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (indian) {
    const year = indian[3].length === 2 ? `20${indian[3]}` : indian[3];
    return `${year}-${indian[2].padStart(2, '0')}-${indian[1].padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? '' : localDateKey(parsed);
}

const RETURN_NUMBER = ['Order Return Number', 'Return Number', 'Order Return No'];
const INVOICE_NUMBER = ['Invoice Number', 'Invoice No'];
const hasColumn = (rows: Record<string, unknown>[], labels: string[]) =>
  rows.length > 0 && readField(rows[0], ...labels) !== undefined;
const amountOf = (value: unknown) => Math.abs(Number(String(value ?? '').replace(/[₹,\s]/g, '')));

/** Reads the rows of a Vastra export for the kind of file the user said it is. */
export function parseVastraSheets(sheets: SheetRows[], kind: UploadKind): { rows: ParsedRow[] } | { error: string } {
  const withRows = sheets.filter(sheet => sheet.rows.length > 0);
  const numberLabels = kind === 'return' ? RETURN_NUMBER : INVOICE_NUMBER;
  if (!withRows.some(sheet => hasColumn(sheet.rows, numberLabels))) {
    const looksLikeOther = withRows.some(sheet => hasColumn(sheet.rows, kind === 'return' ? INVOICE_NUMBER : RETURN_NUMBER));
    return { error: kind === 'return'
      ? `No sales return rows found: the file has no "Order Return Number" column.${looksLikeOther ? ' It looks like a sales invoice file; choose Sales invoices instead.' : ''} Nothing was saved.`
      : `No invoice rows found: the file has no "Invoice Number" column.${looksLikeOther ? ' It looks like a sales return file; choose Sales returns instead.' : ''} Nothing was saved.` };
  }
  const rows: ParsedRow[] = [];
  for (const sheet of withRows) {
    for (const row of sheet.rows) {
      const invoiceNumber = String(readField(row, ...numberLabels) ?? '').trim();
      if (kind === 'return') {
        const amount = amountOf(readField(row, 'Net Amount', 'Order Return Net Amount'));
        if (!invoiceNumber || !Number.isFinite(amount) || amount <= 0) continue;
        rows.push({ invoiceNumber, date: dateCell(readField(row, 'Date', 'Return Date', 'Order Return Date')), totalInvoiceAmount: amount,
          type: 'Return', paymentMode: 'RETURN', cashAmount: 0, upiAmount: 0, cardAmount: 0, bankVerified: true });
        continue;
      }
      const amount = amountOf(readField(row, 'Invoice Net Amount', 'Invoice Amount'));
      if (!invoiceNumber || !Number.isFinite(amount) || amount <= 0) continue;
      const rawMode = String(readField(row, 'Agent Name', 'Payment Mode', 'Mode') ?? '').toUpperCase();
      const mode = rawMode.includes('CASH') ? 'CASH' : rawMode.includes('UPI') ? 'UPI' : rawMode.includes('CARD') ? 'CARD' : 'SPLIT';
      const cash = Number(readField(row, 'Cash Amount', 'Cash') ?? 0) || 0;
      const upi = Number(readField(row, 'UPI Amount', 'UPI') ?? 0) || 0;
      const card = Number(readField(row, 'Card Amount', 'Card') ?? 0) || 0;
      rows.push({ invoiceNumber, date: dateCell(readField(row, 'Invoice Date', 'Date')), totalInvoiceAmount: amount,
        type: 'Invoice', paymentMode: mode,
        cashAmount: mode === 'CASH' ? amount : cash, upiAmount: mode === 'UPI' ? amount : upi, cardAmount: mode === 'CARD' ? amount : card,
        bankVerified: mode === 'CASH' });
    }
  }
  if (!rows.length) return { error: `The file has no ${kind === 'return' ? 'sales return' : 'invoice'} rows with a number and an amount. Nothing was saved.` };
  return { rows };
}
