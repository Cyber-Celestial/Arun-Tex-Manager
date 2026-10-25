import { businessDate } from './pulse-data';

export function reconciliationUploaded(batch: Record<string, any>): boolean {
  return (Array.isArray(batch.transactions) && batch.transactions.length > 0) ||
    Boolean(batch.invoiceImport && typeof batch.invoiceImport === 'object');
}

export function reconciliationLabel(value: unknown): string {
  const day = businessDate(value);
  return day ? new Date(`${day}T12:00:00`).toLocaleDateString('en-IN',
    { day: '2-digit', month: 'short', year: 'numeric' }) : String(value || 'Undated legacy batch');
}

export function emptyReconciliation(date: string) {
  return { id: crypto.randomUUID(), date, status: 'Open', transactions: [], bankRows: [],
    denominations: { '500': 0, '200': 0, '100': 0, '50': 0, '20': 0, '10': 0, '5': 0, '2': 0, '1': 0 } };
}

export type BatchStage = { label: string; tone: 'neutral' | 'warn' | 'good' };

/** Where a reconciliation stands in the Billing submit → Admin approval → lock flow. */
export function batchStage(batch: Record<string, any>): BatchStage {
  if (batch.status === 'Submitted') return { label: 'Locked', tone: 'good' };
  if (batch.adminApproved) return { label: 'Approved · awaiting bank', tone: 'warn' };
  if (batch.billingSubmitted) return { label: 'Cash submitted', tone: 'warn' };
  return { label: 'Open', tone: 'neutral' };
}

export function onlinePaymentCounts(transactions: Record<string, any>[]) {
  const online = transactions.filter(row => row.type !== 'Return' && (Number(row.upiAmount) > 0 || Number(row.cardAmount) > 0));
  return { verified: online.filter(row => row.bankVerified === true).length, total: online.length };
}

export const invoiceKey = (value: unknown): string => String(value ?? '').trim().toUpperCase();

/**
 * Vastra repeats an invoice on one line per item. Reconciliation keeps one entry
 * per invoice number, taking the first line; differing totals are reported.
 */
export function oneEntryPerInvoice<T extends Record<string, any>>(lines: T[]) {
  const first = new Map<string, T>();
  const conflicts = new Set<string>();
  let merged = 0;
  for (const line of lines) {
    const key = invoiceKey(line.invoiceNumber);
    const kept = first.get(key);
    if (!kept) { first.set(key, line); continue; }
    merged++;
    if (Number(kept.totalInvoiceAmount) !== Number(line.totalInvoiceAmount)) conflicts.add(String(kept.invoiceNumber));
  }
  return { rows: [...first.values()], merged, conflicts: [...conflicts] };
}

export type UploadKind = 'invoice' | 'return';
export type UploadSlot = { done: boolean; count: number; fileName: string | null };

/** A B2C day has two upload slots: one sales invoice file and one sales return file. */
export function uploadSlot(batch: Record<string, any>, kind: UploadKind): UploadSlot {
  const rows = (Array.isArray(batch.transactions) ? batch.transactions : []).filter((row: Record<string, any>) => (row.type === 'Return') === (kind === 'return'));
  const stamp = batch[kind === 'return' ? 'returnImport' : 'invoiceImport'];
  const fileName = stamp && typeof stamp === 'object' && stamp.fileName ? String(stamp.fileName) : null;
  return { done: rows.length > 0 || Boolean(stamp && typeof stamp === 'object'), count: rows.length, fileName };
}
