import { isDeepStrictEqual } from 'node:util';
import { reconciliationDate } from './reconciliation-policy';

type RecordValue = Record<string, unknown>;
export type BankRow = {
  date: string; narration: string; reference: string; depositAmount: number;
  mode: 'UPI' | 'CARD' | 'UNCLASSIFIED'; matchedInvoiceNumber: string;
};

const MAX_ROWS = 2000;
const modes = new Set(['UPI', 'CARD', 'UNCLASSIFIED']);
const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Returns clean deposit rows, or null when any row is not a usable HDFC deposit. */
export function sanitizeBankRows(value: unknown): BankRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) return null;
  const rows: BankRow[] = [];
  for (const entry of value) {
    if (!object(entry)) return null;
    const date = reconciliationDate(entry.date);
    const depositAmount = Number(entry.depositAmount);
    const mode = String(entry.mode ?? '');
    if (!date || !Number.isFinite(depositAmount) || depositAmount <= 0 || !modes.has(mode)) return null;
    rows.push({
      date, depositAmount, mode: mode as BankRow['mode'],
      narration: String(entry.narration ?? '').slice(0, 500),
      reference: String(entry.reference ?? '').trim().slice(0, 100),
      matchedInvoiceNumber: '',
    });
  }
  return rows;
}

const rowKey = (row: RecordValue) =>
  [reconciliationDate(row.date), String(row.reference ?? '').trim(), Number(row.depositAmount), String(row.narration ?? '')].join('|');

/** Appends new rows; a row with a bank reference that is already on file is skipped. */
export function appendBankRows(existing: unknown, incoming: BankRow[]): { rows: RecordValue[]; added: number } {
  const rows = Array.isArray(existing) ? existing.filter(object) : [];
  const seen = new Set(rows.filter(row => String(row.reference ?? '').trim()).map(rowKey));
  let added = 0;
  for (const row of incoming) {
    if (row.reference && seen.has(rowKey(row))) continue;
    rows.push({ ...row });
    if (row.reference) seen.add(rowKey(row));
    added++;
  }
  return { rows, added };
}

const statementSource = (row: unknown) => object(row)
  ? [reconciliationDate(row.date) || row.date, String(row.narration ?? ''), String(row.reference ?? ''), Number(row.depositAmount), row.mode]
  : row;

/** The statement itself, ignoring the match results the server writes back. */
function sameStatement(a: unknown, b: unknown): boolean {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  return left.length === right.length && left.every((row, i) => isDeepStrictEqual(statementSource(row), statementSource(right[i])));
}

/** Billing may save B2C data but may not add, change or remove bank statement rows. */
export function validateB2cRoleChange(role: string, next: RecordValue, previous: RecordValue): string | null {
  if (role !== 'billing') return null;
  const after = Array.isArray(next.batches) ? next.batches : [];
  const before = Array.isArray(previous.batches) ? previous.batches : [];
  const changed = after.some((batch, index) =>
    object(batch) && !sameStatement(batch.bankRows, object(before[index]) ? before[index].bankRows : []));
  return changed ? 'Bank statements are uploaded by Accounts or Admin.' : null;
}
