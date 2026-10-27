import { isDeepStrictEqual } from 'node:util';
import { isReconciliationUploaded } from './reconciliation-policy';
import { unaccountedBankRows } from './reconciliation-manual';

type RecordValue = Record<string, unknown>;
export type Actor = { userId: string; name: string; role: string };
export type WorkflowError = { status: number; error: string };
export type LogEntry = { at: string; userId: string; name: string; role: string; action: string; changes?: string[] };

const NOTES = ['500', '200', '100', '50', '20', '10', '5', '2', '1'];
const EDITABLE_FIELDS = [
  ['paymentMode', 'payment mode'], ['type', 'type'], ['totalInvoiceAmount', 'invoice total'],
  ['cashAmount', 'cash'], ['upiAmount', 'UPI'], ['cardAmount', 'card'],
] as const;
const MAX_LOGGED_CHANGES = 25;

const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const amount = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cents = (n: number) => Math.round(n * 100);
const transactions = (batch: RecordValue | undefined): RecordValue[] =>
  Array.isArray(batch?.transactions) ? (batch.transactions as unknown[]).filter(object) : [];
const fail = (status: number, error: string): WorkflowError => ({ status, error });

export function expectedCash(batch: RecordValue): number {
  return transactions(batch).reduce((sum, row) =>
    row.type === 'Return' ? sum - Math.abs(amount(row.totalInvoiceAmount)) : sum + amount(row.cashAmount), 0);
}

export function countedCash(denominations: unknown): number {
  if (!object(denominations)) return 0;
  return NOTES.reduce((sum, note) => {
    const count = Number(denominations[note] ?? 0);
    return sum + (Number.isFinite(count) && count > 0 ? Number(note) * count : 0);
  }, 0);
}

export function onlinePending(batch: RecordValue): boolean {
  return unaccountedBankRows(batch) > 0 || transactions(batch).some(row => row.type !== 'Return' &&
    (amount(row.upiAmount) > 0 || amount(row.cardAmount) > 0) && row.bankVerified !== true);
}

const invoiceView = (rows: RecordValue[]) => rows.map(row => [row.invoiceNumber, ...EDITABLE_FIELDS.map(([key]) => row[key])]);
const noteCounts = (denominations: unknown) => NOTES.map(note => (object(denominations) ? amount(denominations[note]) : 0));

function contentChanged(old: RecordValue | undefined, next: RecordValue): boolean {
  return !isDeepStrictEqual(invoiceView(transactions(old)), invoiceView(transactions(next))) ||
    !isDeepStrictEqual(noteCounts(old?.denominations), noteCounts(next.denominations));
}

function describeChanges(old: RecordValue | undefined, next: RecordValue): string[] {
  const before = transactions(old), after = transactions(next);
  if (!before.length && after.length) return [`Imported ${after.length} invoices and returns`];
  const changes: string[] = [];
  const oldByNumber = new Map(before.map(row => [String(row.invoiceNumber), row]));
  const newByNumber = new Map(after.map(row => [String(row.invoiceNumber), row]));
  for (const [number, row] of newByNumber) {
    const previous = oldByNumber.get(number);
    if (!previous) { changes.push(`Added ${number}`); continue; }
    for (const [key, label] of EDITABLE_FIELDS) {
      const was = String(previous[key] ?? ''), now = String(row[key] ?? '');
      if (was !== now) changes.push(`${number}: ${label} ${was} → ${now}`);
    }
  }
  for (const number of oldByNumber.keys()) if (!newByNumber.has(number)) changes.push(`Removed ${number}`);
  NOTES.forEach((note, i) => {
    const was = noteCounts(old?.denominations)[i], now = noteCounts(next.denominations)[i];
    if (was !== now) changes.push(`₹${note} notes: ${was} → ${now}`);
  });
  return changes.length > MAX_LOGGED_CHANGES
    ? [...changes.slice(0, MAX_LOGGED_CHANGES), `…and ${changes.length - MAX_LOGGED_CHANGES} more changes`] : changes;
}

export function logEntry(action: string, actor: Actor, now: string, changes?: string[]): LogEntry {
  return { at: now, userId: actor.userId, name: actor.name, role: actor.role, action, ...(changes?.length ? { changes } : {}) };
}

/** Locks the batch once Billing submitted, Admin approved and every online payment is bank-verified. */
export function settleBatch(batch: RecordValue, actor: Actor, now: string): boolean {
  if (batch.status === 'Submitted' || batch.billingSubmitted !== true || batch.adminApproved !== true || onlinePending(batch)) return false;
  batch.status = 'Submitted';
  batch.lockedAt = now;
  batch.editLog = [...(Array.isArray(batch.editLog) ? batch.editLog : []), logEntry('lock', actor, now)];
  return true;
}

/**
 * Applies the cash workflow to the batches a caller saved. The client may ask for
 * "submitted" or "approved"; stamps, status and the change log are decided here.
 */
export function applyBatchWorkflow(next: unknown[], previous: unknown[], actor: Actor, now: string): WorkflowError | null {
  for (let index = 0; index < next.length; index++) {
    const batch = next[index];
    if (!object(batch)) continue;
    const old = object(previous[index]) ? previous[index] as RecordValue : undefined;
    if (old?.status === 'Submitted') continue;

    const wantsSubmit = batch.billingSubmitted === true;
    const wantsApproval = batch.adminApproved === true;
    if (old?.billingSubmitted === true && !wantsSubmit) return fail(400, 'A submitted cash batch cannot be withdrawn.');
    if (old?.adminApproved === true && !wantsApproval) return fail(400, 'An approved cash batch cannot be withdrawn.');

    for (const key of ['billingSubmittedAt', 'billingSubmittedBy', 'adminApprovedAt', 'adminApprovedBy', 'lockedAt', 'returnImport']) {
      if (old && key in old) batch[key] = old[key]; else delete batch[key];
    }
    batch.status = old?.status ?? 'Open';
    batch.billingSubmitted = old?.billingSubmitted === true;
    batch.adminApproved = old?.adminApproved === true;
    const log: LogEntry[] = Array.isArray(old?.editLog) ? [...old.editLog as LogEntry[]] : [];

    const edited = contentChanged(old, batch);
    if (old?.billingSubmitted === true && edited && actor.role === 'billing')
      return fail(403, 'The cash batch is submitted. Ask an Admin to make changes.');

    if (wantsSubmit && !batch.billingSubmitted) {
      if (!isReconciliationUploaded(batch)) return fail(400, 'Upload the invoice workbook before submitting the cash batch.');
      if (cents(countedCash(batch.denominations)) !== cents(expectedCash(batch)))
        return fail(400, 'Cash counted must equal expected cash before the batch can be submitted.');
      batch.billingSubmitted = true;
      batch.billingSubmittedAt = now;
      batch.billingSubmittedBy = actor.name;
      log.push(logEntry('billing-submit', actor, now));
    }
    if (wantsApproval && !batch.adminApproved) {
      if (actor.role !== 'admin') return fail(403, 'Only an Admin can approve the cash batch.');
      if (old?.billingSubmitted !== true) return fail(400, 'Billing must submit the cash batch before it can be approved.');
      batch.adminApproved = true;
      batch.adminApprovedAt = now;
      batch.adminApprovedBy = actor.name;
      log.push(logEntry('admin-approve', actor, now));
    }
    if (edited && actor.role === 'admin') {
      log.push(logEntry('edit', actor, now, describeChanges(old, batch)));
      if (old?.adminApproved === true) {
        batch.adminApproved = false;
        delete batch.adminApprovedAt;
        delete batch.adminApprovedBy;
        log.push(logEntry('approval-cleared', actor, now));
      }
    }
    batch.editLog = log;
    settleBatch(batch, actor, now);
  }
  return null;
}
