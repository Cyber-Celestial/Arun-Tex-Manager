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
