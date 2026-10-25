import { randomUUID } from 'node:crypto';
import { isReconciliationUploaded, reconciliationDate } from './reconciliation-policy';
import { logEntry, type Actor } from './reconciliation-workflow';

type RecordValue = Record<string, unknown>;
export type UploadInput = { date: unknown; fileName: unknown; replace?: unknown; transactions: unknown };
export type UploadResult = { data: RecordValue; batchIndex: number; replaced: boolean } | { status: number; error: string };

const MAX_ROWS = 5000;
const MODES = new Set(['CASH', 'CARD', 'UPI', 'SPLIT', 'RETURN']);
const NOTES = ['500', '200', '100', '50', '20', '10', '5', '2', '1'];
const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const invoiceKey = (v: unknown) => String(v ?? '').trim().toUpperCase();
const rowsOf = (batch: RecordValue): RecordValue[] => (Array.isArray(batch.transactions) ? batch.transactions.filter(object) : []);
const money = (v: unknown) => (v === undefined || v === null || v === '' ? 0 : Number(v));

/** Keeps only the fields a Vastra import may set, and checks every row belongs to the chosen day. */
export function cleanUploadRows(value: unknown, day: string): { rows: RecordValue[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: 'The file has no invoice rows.' };
  if (value.length > MAX_ROWS) return { error: `A day can hold at most ${MAX_ROWS} invoices.` };
  const seen = new Set<string>();
  const rows: RecordValue[] = [];
  for (const entry of value) {
    if (!object(entry)) return { error: 'An invoice row is not valid.' };
    const invoiceNumber = String(entry.invoiceNumber ?? '').trim();
    if (!invoiceNumber) return { error: 'Every invoice needs an invoice number.' };
    const key = invoiceKey(invoiceNumber);
    if (seen.has(key)) return { error: `Invoice number ${invoiceNumber} appears twice in the file. Each invoice or return number can appear only once.` };
    seen.add(key);
    if (reconciliationDate(entry.date) !== day)
      return { error: `Every invoice in the file must be dated ${day}; ${invoiceNumber} is dated ${String(entry.date || 'with no date')}.` };
    const type = entry.type === 'Return' ? 'Return' : 'Invoice';
    const paymentMode = String(entry.paymentMode ?? '');
    const total = Number(entry.totalInvoiceAmount);
    const [cash, upi, card] = [money(entry.cashAmount), money(entry.upiAmount), money(entry.cardAmount)];
    if (!MODES.has(paymentMode) || !Number.isFinite(total) || total < 0 || ![cash, upi, card].every(n => Number.isFinite(n) && n >= 0))
      return { error: `Invoice ${invoiceNumber} has an invalid amount or payment mode.` };
    const online = type !== 'Return' && (upi > 0 || card > 0);
    rows.push({
      invoiceNumber, date: day, totalInvoiceAmount: total, type, paymentMode,
      cashAmount: type === 'Return' ? 0 : cash, upiAmount: type === 'Return' ? 0 : upi, cardAmount: type === 'Return' ? 0 : card,
      bankVerified: !online,
    });
  }
  return { rows };
}

/**
 * Adds one day's Vastra invoices to the B2C data. The day comes from the file itself.
 * An existing uploaded day is only replaced when the caller asks for it, and never once locked.
 */
export function applyUpload(b2c: RecordValue, input: UploadInput, actor: Actor, now: string): UploadResult {
  const day = reconciliationDate(input.date);
  if (!day) return { status: 400, error: 'The file needs one valid invoice date.' };
  const cleaned = cleanUploadRows(input.transactions, day);
  if ('error' in cleaned) return { status: 400, error: cleaned.error };
  const fileName = String(input.fileName ?? '').slice(0, 255);

  const batches = Array.isArray(b2c.batches) ? [...b2c.batches] : [];
  const index = batches.findIndex(batch => object(batch) && reconciliationDate(batch.date) === day);
  const existing = index >= 0 && object(batches[index]) ? batches[index] as RecordValue : undefined;

  const taken = new Map<string, string>();
  batches.forEach((batch, i) => {
    if (i === index || !object(batch)) return;
    for (const row of rowsOf(batch)) taken.set(invoiceKey(row.invoiceNumber), reconciliationDate(batch.date) || 'another day');
  });
  for (const row of cleaned.rows) {
    const where = taken.get(invoiceKey(row.invoiceNumber));
    if (where) return { status: 409, error: `Invoice number ${String(row.invoiceNumber)} is already recorded in B2C for ${where}. Each invoice or return number can appear only once.` };
  }

  const stamp = { id: randomUUID(), fileName, importedAt: now };
  if (!existing) {
    const created: RecordValue = {
      id: randomUUID(), date: day, status: 'Open', transactions: cleaned.rows, bankRows: [],
      denominations: Object.fromEntries(NOTES.map(note => [note, 0])), invoiceImport: stamp,
      billingSubmitted: false, adminApproved: false, editLog: [],
    };
    return { data: { ...b2c, batches: [...batches, created] }, batchIndex: batches.length, replaced: false };
  }

  const uploaded = isReconciliationUploaded(existing);
  if (uploaded && input.replace !== true)
    return { status: 409, error: `B2C for ${day} already has ${rowsOf(existing).length} invoices. Choose Replace to upload this file over them.` };
  if (existing.status === 'Submitted')
    return { status: 409, error: `B2C for ${day} is locked. An Admin can delete the day first, then upload again.` };
  if (uploaded && existing.billingSubmitted === true && actor.role !== 'admin')
    return { status: 403, error: 'The cash batch is submitted. Ask an Admin to replace this day.' };

  const next: RecordValue = {
    ...existing, transactions: cleaned.rows, invoiceImport: stamp, status: 'Open',
    billingSubmitted: false, adminApproved: false,
    editLog: Array.isArray(existing.editLog) ? [...existing.editLog] : [],
  };
  for (const key of ['billingSubmittedAt', 'billingSubmittedBy', 'adminApprovedAt', 'adminApprovedBy', 'lockedAt']) delete next[key];
  if (uploaded)
    (next.editLog as unknown[]).push(logEntry('replace', actor, now, [`Replaced ${rowsOf(existing).length} invoices with ${cleaned.rows.length} from ${fileName || 'a new file'}`]));
  const updated = [...batches];
  updated[index] = next;
  return { data: { ...b2c, batches: updated }, batchIndex: index, replaced: uploaded };
}
