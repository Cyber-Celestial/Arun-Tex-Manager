import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const rows = (batch: RecordValue): unknown[] => Array.isArray(batch.transactions) ? batch.transactions : [];

/** Keep the calendar part of a business date, never convert it through UTC. */
export function reconciliationDate(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return '';
  const [, y, m, d] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(y), Number(m) - 1, Number(d));
  return Number(y) > 0 && date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? `${y}-${m}-${d}` : '';
}

export function isReconciliationUploaded(batch: RecordValue): boolean {
  return rows(batch).length > 0 || object(batch.invoiceImport);
}

// These fields describe the imported source, not the editable payment allocation.
// Payment mode/type is editable in the existing UI; the original row count,
// invoice identifier, invoice date and gross amount must not be reimported.
function sourceRows(batch: RecordValue): string[] {
  return rows(batch).map(row => object(row)
    ? JSON.stringify([String(row.invoiceNumber ?? ''), reconciliationDate(row.date) || row.date || '',
      Number(row.totalInvoiceAmount)])
    : JSON.stringify(row)).sort();
}

const invoiceKey = (value: unknown) => String(value ?? '').trim().toUpperCase();

function invoiceCounts(batches: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const batch of batches) {
    if (!object(batch)) continue;
    for (const row of rows(batch)) {
      const key = object(row) ? invoiceKey(row.invoiceNumber) : '';
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/** An invoice or return number may appear once; legacy repeats may stay but cannot grow. */
function newDuplicateInvoice(before: unknown[], after: unknown[]): string | null {
  const old = invoiceCounts(before);
  for (const [key, count] of invoiceCounts(after)) {
    if (count > Math.max(1, old.get(key) || 0)) return key;
  }
  return null;
}

/**
 * Validate against the persisted state before stamping a first successful import.
 * Legacy duplicates may remain, but cannot increase or gain a second upload.
 * The caller must still use its expectedVersion conditional database update.
 */
export function validateReconciliationChange(next: RecordValue, previous: RecordValue): string | null {
  if (!Array.isArray(next.batches)) return 'B2C data must contain a batches list.';
  const before = Array.isArray(previous.batches) ? previous.batches : [];
  const after = next.batches;
  if (after.length < before.length) return 'Existing reconciliations cannot be removed by an upload.';
  const oldCounts = new Map<string, number>();
  const nextCounts = new Map<string, number>();
  const uploadedBefore = new Map<string, number>();
  const uploadedAfter = new Map<string, number>();
  for (const batch of before) {
    if (!object(batch)) continue;
    const day = reconciliationDate(batch.date);
    if (day) oldCounts.set(day, (oldCounts.get(day) || 0) + 1);
    if (day && isReconciliationUploaded(batch)) uploadedBefore.set(day, (uploadedBefore.get(day) || 0) + 1);
  }
  for (let index = 0; index < after.length; index++) {
    const batch = after[index];
    if (!object(batch) || !Array.isArray(batch.transactions)) return 'A reconciliation must contain a transactions list.';
    const old = object(before[index]) ? before[index] as RecordValue : undefined;
    const day = reconciliationDate(batch.date);
    // Do not make an unchanged legacy invalid date block unrelated work.
    if (!day && (!old || batch.date !== old.date)) return 'Choose a valid reconciliation business date.';
    if (old && ((reconciliationDate(old.date) || old.date) !== (day || batch.date) ||
      (old.id !== undefined && old.id !== batch.id))) {
      return 'An existing reconciliation date or identity cannot be changed. Open the required date instead.';
    }
    if (day) {
      nextCounts.set(day, (nextCounts.get(day) || 0) + 1);
      if (isReconciliationUploaded(batch)) uploadedAfter.set(day, (uploadedAfter.get(day) || 0) + 1);
    }
    if (old && isReconciliationUploaded(old)) {
      if (!isDeepStrictEqual(sourceRows(old), sourceRows(batch)) ||
        !isDeepStrictEqual(old.invoiceImport, batch.invoiceImport)) {
        return `Reconciliation for ${day || String(batch.date)} has already been uploaded. Open the existing reconciliation; a second invoice upload is not allowed.`;
      }
    } else if (object(batch.invoiceImport) && rows(batch).length === 0) {
      return 'A successful reconciliation upload must contain invoice or return rows.';
    }
  }
  for (const [day, count] of nextCounts) {
    if (count > Math.max(1, oldCounts.get(day) || 0))
      return `A reconciliation already exists for ${day}. Open the existing reconciliation instead.`;
  }
  for (const [day, count] of uploadedAfter) {
    if (count > Math.max(1, uploadedBefore.get(day) || 0))
      return `Reconciliation for ${day} has already been uploaded. A second invoice upload is not allowed.`;
  }
  const duplicate = newDuplicateInvoice(before, after);
  if (duplicate) return `Invoice number ${duplicate} is already recorded. Each invoice or return number can appear only once.`;
  // Only stamp after every check succeeds. The conditional DB write makes the
  // source rows and this server-owned receipt one atomic state change.
  after.forEach((batch, index) => {
    if (!object(batch) || !rows(batch).length) return;
    const old = before[index];
    if (object(old) && isReconciliationUploaded(old)) return;
    const fileName = object(batch.invoiceImport) ? String(batch.invoiceImport.fileName ?? '').slice(0, 255) : '';
    batch.invoiceImport = { id: randomUUID(), fileName, importedAt: new Date().toISOString() };
  });
  return null;
}
