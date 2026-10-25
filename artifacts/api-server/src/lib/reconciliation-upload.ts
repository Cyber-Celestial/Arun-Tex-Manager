import { randomUUID } from 'node:crypto';
import { reconciliationDate } from './reconciliation-policy';
import { logEntry, type Actor } from './reconciliation-workflow';

type RecordValue = Record<string, unknown>;
export type UploadKind = 'invoice' | 'return';
export type UploadInput = { date: unknown; fileName: unknown; kind?: unknown; replace?: unknown; transactions: unknown };
export type UploadResult = { data: RecordValue; batchIndex: number; replaced: boolean } | { status: number; error: string };

const MAX_ROWS = 5000;
const MODES = new Set(['CASH', 'CARD', 'UPI', 'SPLIT', 'RETURN']);
const NOTES = ['500', '200', '100', '50', '20', '10', '5', '2', '1'];
const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const invoiceKey = (v: unknown) => String(v ?? '').trim().toUpperCase();
const rowsOf = (batch: RecordValue): RecordValue[] => (Array.isArray(batch.transactions) ? batch.transactions.filter(object) : []);
const money = (v: unknown) => (v === undefined || v === null || v === '' ? 0 : Number(v));

const stampKey = (kind: UploadKind) => (kind === 'return' ? 'returnImport' : 'invoiceImport');
const rowsOfKind = (batch: RecordValue, kind: UploadKind) => rowsOf(batch).filter(row => (row.type === 'Return') === (kind === 'return'));
const noun = (kind: UploadKind) => (kind === 'return' ? 'returns' : 'invoices');

/** A day holds at most one invoice upload and one sales-return upload. */
export function hasUpload(batch: RecordValue, kind: UploadKind): boolean {
  return object(batch[stampKey(kind)]) || rowsOfKind(batch, kind).length > 0;
}

/** Keeps only the fields a Vastra import may set, and checks every row belongs to the chosen day and kind. */
export function cleanUploadRows(value: unknown, day: string, kind: UploadKind = 'invoice'): { rows: RecordValue[] } | { error: string } {
  const label = kind === 'return' ? 'return' : 'invoice';
  if (!Array.isArray(value) || value.length === 0) return { error: `The file has no ${label} rows.` };
  if (value.length > MAX_ROWS) return { error: `A day can hold at most ${MAX_ROWS} ${noun(kind)}.` };
  const seen = new Set<string>();
  const rows: RecordValue[] = [];
  for (const entry of value) {
    if (!object(entry)) return { error: `A ${label} row is not valid.` };
    const invoiceNumber = String(entry.invoiceNumber ?? '').trim();
    if (!invoiceNumber) return { error: `Every ${label} needs a ${kind === 'return' ? 'return' : 'invoice'} number.` };
    const key = invoiceKey(invoiceNumber);
    if (seen.has(key)) return { error: `Number ${invoiceNumber} appears twice in the file. Each invoice or return number can appear only once.` };
    seen.add(key);
    if (reconciliationDate(entry.date) !== day)
      return { error: `Every ${label} in the file must be dated ${day}; ${invoiceNumber} is dated ${String(entry.date || 'with no date')}.` };
    const type = kind === 'return' ? 'Return' : 'Invoice';
    if (entry.type !== undefined && (entry.type === 'Return') !== (kind === 'return'))
      return { error: `${invoiceNumber} is ${entry.type === 'Return' ? 'a return' : 'an invoice'}, but this upload is for ${noun(kind)}.` };
    const paymentMode = kind === 'return' ? 'RETURN' : String(entry.paymentMode ?? '');
    const total = Number(entry.totalInvoiceAmount);
    const [cash, upi, card] = [money(entry.cashAmount), money(entry.upiAmount), money(entry.cardAmount)];
    if (!MODES.has(paymentMode) || (kind === 'invoice' && paymentMode === 'RETURN') || !Number.isFinite(total) || total < 0 ||
      ![cash, upi, card].every(n => Number.isFinite(n) && n >= 0))
      return { error: `${invoiceNumber} has an invalid amount or payment mode.` };
    const online = kind === 'invoice' && (upi > 0 || card > 0);
    rows.push({
      invoiceNumber, date: day, totalInvoiceAmount: total, type, paymentMode,
      cashAmount: kind === 'return' ? 0 : cash, upiAmount: kind === 'return' ? 0 : upi, cardAmount: kind === 'return' ? 0 : card,
      bankVerified: !online,
    });
  }
  return { rows };
}

/**
 * Adds one Vastra file (sales invoices or sales returns) to a B2C day. The day comes from the file.
 * Each kind can be uploaded once per day; uploading it again needs Replace and only swaps that kind.
 */
export function applyUpload(b2c: RecordValue, input: UploadInput, actor: Actor, now: string): UploadResult {
  const kind: UploadKind = input.kind === 'return' ? 'return' : 'invoice';
  const day = reconciliationDate(input.date);
  if (!day) return { status: 400, error: 'The file needs one valid date.' };
  const cleaned = cleanUploadRows(input.transactions, day, kind);
  if ('error' in cleaned) return { status: 400, error: cleaned.error };
  const fileName = String(input.fileName ?? '').slice(0, 255);

  const batches = Array.isArray(b2c.batches) ? [...b2c.batches] : [];
  const index = batches.findIndex(batch => object(batch) && reconciliationDate(batch.date) === day);
  const existing = index >= 0 && object(batches[index]) ? batches[index] as RecordValue : undefined;
  const otherKind: UploadKind = kind === 'return' ? 'invoice' : 'return';
  const keptRows = existing ? rowsOfKind(existing, otherKind) : [];

  const taken = new Map<string, string>();
  batches.forEach((batch, i) => {
    if (i === index || !object(batch)) return;
    for (const row of rowsOf(batch)) taken.set(invoiceKey(row.invoiceNumber), reconciliationDate(batch.date) || 'another day');
  });
  for (const row of keptRows) taken.set(invoiceKey(row.invoiceNumber), day);
  for (const row of cleaned.rows) {
    const where = taken.get(invoiceKey(row.invoiceNumber));
    if (where) return { status: 409, error: `Number ${String(row.invoiceNumber)} is already recorded in B2C for ${where}. Each invoice or return number can appear only once.` };
  }

  const stamp = { id: randomUUID(), fileName, importedAt: now };
  if (!existing) {
    const created: RecordValue = {
      id: randomUUID(), date: day, status: 'Open', transactions: cleaned.rows, bankRows: [],
      denominations: Object.fromEntries(NOTES.map(note => [note, 0])), [stampKey(kind)]: stamp,
      billingSubmitted: false, adminApproved: false, editLog: [],
    };
    return { data: { ...b2c, batches: [...batches, created] }, batchIndex: batches.length, replaced: false };
  }

  const already = hasUpload(existing, kind);
  if (already && input.replace !== true)
    return { status: 409, error: `B2C for ${day} already has ${rowsOfKind(existing, kind).length} ${noun(kind)}. Choose Replace to upload this file over them.` };
  if (existing.status === 'Submitted')
    return { status: 409, error: `B2C for ${day} is locked. An Admin can delete the day first, then upload again.` };
  if (existing.billingSubmitted === true && actor.role !== 'admin')
    return { status: 403, error: 'The cash batch is submitted. Ask an Admin to change this day.' };

  const next: RecordValue = {
    ...existing,
    transactions: kind === 'return' ? [...keptRows, ...cleaned.rows] : [...cleaned.rows, ...keptRows],
    [stampKey(kind)]: stamp, status: 'Open', billingSubmitted: false, adminApproved: false,
    editLog: Array.isArray(existing.editLog) ? [...existing.editLog] : [],
  };
  for (const key of ['billingSubmittedAt', 'billingSubmittedBy', 'adminApprovedAt', 'adminApprovedBy', 'lockedAt']) delete next[key];
  (next.editLog as unknown[]).push(logEntry(already ? 'replace' : 'upload', actor, now, [
    already
      ? `Replaced ${rowsOfKind(existing, kind).length} ${noun(kind)} with ${cleaned.rows.length} from ${fileName || 'a new file'}`
      : `Added ${cleaned.rows.length} ${noun(kind)} from ${fileName || 'a new file'}`,
  ]));
  const updated = [...batches];
  updated[index] = next;
  return { data: { ...b2c, batches: updated }, batchIndex: index, replaced: already };
}
