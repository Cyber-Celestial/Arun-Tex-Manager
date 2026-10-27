import { isDeepStrictEqual } from 'node:util';
import { reconciliationDate } from './reconciliation-policy';

type RecordValue = Record<string, unknown>;
export type BankRow = {
  date: string; narration: string; reference: string; depositAmount: number;
  mode: 'UPI' | 'CARD'; matchedInvoiceNumber: string;
};

const MAX_ROWS = 2000;
export const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export const cents = (value: number) => Math.round(value * 100);

export function classifyBankMode(row: RecordValue): 'UPI' | 'CARD' | null {
  const mode = String(row.mode ?? '').toUpperCase();
  if (mode.includes('UPI')) return 'UPI';
  if (mode.includes('CARD')) return 'CARD';
  if (mode) return null;
  const narration = String(row.narration ?? '').toUpperCase();
  if (narration.includes('UPI') || narration.includes('@')) return 'UPI';
  if (['POS', 'SWIPE', 'MERCHANT', 'SETTLEMENT'].some(word => narration.includes(word))) return 'CARD';
  return null;
}

/** Recomputes same-day matches without discarding Admin-recorded late matches. */
export function matchOnlinePayments(data: RecordValue, role: string): void {
  if (!Array.isArray(data.batches)) return;
  for (const batchValue of data.batches) {
    if (!object(batchValue) || !Array.isArray(batchValue.transactions)) continue;
    const batch = batchValue;
    const transactions = batch.transactions as unknown[];
    const bankRows = Array.isArray(batch.bankRows) ? batch.bankRows.filter(object) : [];
    const allocated = new Set<RecordValue>();

    for (const transactionValue of transactions) {
      if (!object(transactionValue) || transactionValue.type === 'Return') continue;
      const transaction = transactionValue;
      const invoiceNumber = String(transaction.invoiceNumber ?? '');
      const expected = [
        { mode: 'UPI' as const, amount: Number(transaction.upiAmount ?? 0) },
        { mode: 'CARD' as const, amount: Number(transaction.cardAmount ?? 0) },
      ].filter(part => part.amount > 0);
      if (!expected.length) continue;

      const lateMatches = Array.isArray(transaction.lateBankMatches)
        ? transaction.lateBankMatches.filter(object)
          .filter(match => expected.some(part => part.mode === match.mode))
          .map(match => ({
            mode: match.mode as 'UPI' | 'CARD',
            reference: String(match.reference ?? ''),
            amount: Number(match.amount ?? 0),
          }))
        : [];
      const matches: Array<{ mode: 'UPI' | 'CARD'; reference: string; amount: number }> = [...lateMatches];
      for (const part of expected) {
        if (matches.some(match => match.mode === part.mode)) continue;
        const bankRow = bankRows.find(row => {
          if (allocated.has(row) || classifyBankMode(row) !== part.mode) return false;
          const assignedInvoice = String(row.matchedInvoiceNumber ?? '').trim();
          if (assignedInvoice && assignedInvoice !== invoiceNumber) return false;
          if (assignedInvoice === invoiceNumber && row.matchedMode && row.matchedMode !== part.mode) return false;
          const date = String(row.date ?? '').slice(0, 10);
          const transactionDate = String(transaction.date ?? '').slice(0, 10);
          const deposit = Number(row.depositAmount);
          return date === transactionDate && Number.isFinite(deposit) &&
            Math.round(deposit * 100) === Math.round(part.amount * 100);
        });
        if (!bankRow) continue;
        allocated.add(bankRow);
        const reference = String(bankRow.reference ?? bankRow.bankTransactionId ?? '');
        matches.push({ mode: part.mode, reference, amount: part.amount });
        bankRow.matchedInvoiceNumber = invoiceNumber;
        bankRow.matchedMode = part.mode;
      }

      const fullyMatched = expected.every(part => matches.some(match => match.mode === part.mode));
      const override = role === 'admin' && transaction.adminOverride === true;
      const noted = Array.isArray(transaction.lateBankMatches) && transaction.lateBankMatches.some(match => object(match) && match.kind === 'note');
      transaction.bankMatches = matches;
      transaction.bankVerified = fullyMatched || override;
      transaction.bankTransactionId = matches.length === 1 ? matches[0].reference || null : null;
      transaction.bankVerificationStatus = fullyMatched ? (noted ? 'Noted by Admin' : 'Matched') : override ? 'Admin override' : 'Missing bank entry';
    }
  }
}

/** Returns clean UPI/card deposits, ignoring every other transaction type. */
export function sanitizeBankRows(value: unknown): BankRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) return null;
  const rows: BankRow[] = [];
  for (const entry of value) {
    if (!object(entry)) return null;
    const mode = classifyBankMode(entry);
    if (!mode) continue;
    const date = reconciliationDate(entry.date);
    const depositAmount = Number(entry.depositAmount);
    if (!date || !Number.isFinite(depositAmount) || depositAmount <= 0) return null;
    rows.push({
      date, depositAmount, mode,
      narration: String(entry.narration ?? '').slice(0, 500),
      reference: String(entry.reference ?? '').trim().slice(0, 100),
      matchedInvoiceNumber: '',
    });
  }
  return rows.length ? rows : null;
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

/** Late-match audit fields may only be changed by the dedicated Admin endpoint. */
export function validateLateMatchProtection(next: RecordValue, previous: RecordValue): string | null {
  const batches = (value: RecordValue) => Array.isArray(value.batches) ? value.batches : [];
  const lateState = (value: unknown) => {
    if (!object(value)) return { transactions: {}, bankRows: {} };
    const transactions: Record<string, unknown> = {};
    for (const entry of Array.isArray(value.transactions) ? value.transactions : []) {
      if (!object(entry) || !Array.isArray(entry.lateBankMatches) || !entry.lateBankMatches.length) continue;
      transactions[String(entry.invoiceNumber ?? '')] = {
        invoiceNumber: entry.invoiceNumber,
        date: entry.date,
        type: entry.type,
        upiAmount: entry.upiAmount,
        cardAmount: entry.cardAmount,
        lateBankMatches: entry.lateBankMatches,
      };
    }
    const bankRows: Record<string, unknown> = {};
    (Array.isArray(value.bankRows) ? value.bankRows : []).forEach((entry, index) => {
      if (object(entry) && (object(entry.lateMatch) || object(entry.manualNote))) {
        bankRows[String(index)] = {
          lateMatch: entry.lateMatch,
          manualNote: entry.manualNote,
          matchedInvoiceNumber: entry.matchedInvoiceNumber ?? '',
          matchedMode: entry.matchedMode ?? '',
          date: entry.date,
          narration: entry.narration,
          reference: entry.reference,
          depositAmount: entry.depositAmount,
          mode: entry.mode,
        };
      }
    });
    return { transactions, bankRows };
  };
  const previousBatches = batches(previous);
  const nextBatches = batches(next);
  const length = Math.max(previousBatches.length, nextBatches.length);
  for (let index = 0; index < length; index++) {
    if (!isDeepStrictEqual(lateState(previousBatches[index]), lateState(nextBatches[index]))) {
      return 'Late bank matches can only be changed using the Admin late-match action.';
    }
  }
  return null;
}

export type LateMatchInput = {
  paymentBatchId: string;
  invoiceNumber: string;
  mode: 'UPI' | 'CARD';
  depositBatchId: string;
  bankRowIndex: number;
  note: string;
};

export type LateMatchActor = { userId: string; name: string; role: string };

/** Applies the narrow Admin-only late-match adjustment to an earlier payment and later deposit. */
export function applyLateBankMatch(
  b2c: RecordValue,
  input: LateMatchInput,
  actor: LateMatchActor,
  now: string,
): string | null {
  if (actor.role !== 'admin') return 'Only an Admin can record a late bank match.';
  const note = input.note.trim();
  if (!note || note.length > 500) return 'Add a note of up to 500 characters.';
  if (!Array.isArray(b2c.batches)) return 'B2C data is not available.';

  const batches = b2c.batches.filter(object);
  const paymentBatch = batches.find(batch => String(batch.id ?? '') === input.paymentBatchId);
  const depositBatch = batches.find(batch => String(batch.id ?? '') === input.depositBatchId);
  if (!paymentBatch || !depositBatch) return 'The selected B2C day could not be found.';

  const transaction = (Array.isArray(paymentBatch.transactions) ? paymentBatch.transactions : [])
    .filter(object)
    .find(row => String(row.invoiceNumber ?? '') === input.invoiceNumber);
  const bankRows = Array.isArray(depositBatch.bankRows) ? depositBatch.bankRows : [];
  const bankRow = bankRows[input.bankRowIndex];
  if (!transaction || !object(bankRow)) return 'The selected payment or bank deposit could not be found.';
  if (transaction.type === 'Return') return 'Sales returns cannot be matched to a bank deposit.';

  const paymentDate = reconciliationDate(transaction.date);
  const depositDate = reconciliationDate(bankRow.date);
  if (!paymentDate || !depositDate || depositDate <= paymentDate) {
    return 'A late match must use a deposit dated after the original payment.';
  }

  const mode = classifyBankMode(bankRow);
  if (mode !== input.mode) return 'The deposit mode does not match the selected UPI or card payment.';
  const expectedAmount = Number(input.mode === 'UPI' ? transaction.upiAmount : transaction.cardAmount);
  const depositAmount = Number(bankRow.depositAmount);
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 ||
      !Number.isFinite(depositAmount) || cents(expectedAmount) !== cents(depositAmount)) {
    return 'The deposit amount must exactly match the selected payment allocation.';
  }

  const previousLateMatches = Array.isArray(transaction.lateBankMatches)
    ? transaction.lateBankMatches.filter(object)
    : [];
  const previousMatches = Array.isArray(transaction.bankMatches)
    ? transaction.bankMatches.filter(object)
    : [];
  if (previousLateMatches.some(match => match.mode === input.mode) ||
      previousMatches.some(match => match.mode === input.mode)) {
    return `The ${input.mode} payment is already matched.`;
  }
  if (String(bankRow.matchedInvoiceNumber ?? '').trim() || object(bankRow.lateMatch)) {
    return 'This bank deposit is already matched.';
  }

  const reference = String(bankRow.reference ?? bankRow.bankTransactionId ?? '');
  const targetIdentity = reference
    ? `ref|${depositDate}|${reference}|${cents(depositAmount)}`
    : `row|${depositDate}|${mode}|${cents(depositAmount)}|${String(bankRow.narration ?? '').trim().toUpperCase()}`;
  if (reference && batches.some(batch =>
    (Array.isArray(batch.bankRows) ? batch.bankRows : []).some((candidate, index) =>
      candidate !== bankRow && object(candidate) &&
      String(candidate.reference ?? candidate.bankTransactionId ?? '') === reference &&
      reconciliationDate(candidate.date) === depositDate &&
      cents(Number(candidate.depositAmount)) === cents(depositAmount) &&
      (String(candidate.matchedInvoiceNumber ?? '').trim() || object(candidate.lateMatch))
    ))) {
    return 'This bank deposit was already matched from another B2C day.';
  }
  if (!reference && batches.some(batch =>
    (Array.isArray(batch.bankRows) ? batch.bankRows : []).some(candidate => {
      if (candidate === bankRow || !object(candidate)) return false;
      const candidateDate = reconciliationDate(candidate.date);
      const candidateMode = classifyBankMode(candidate);
      const candidateAmount = Number(candidate.depositAmount);
      const identity = `row|${candidateDate}|${candidateMode}|${cents(candidateAmount)}|${String(candidate.narration ?? '').trim().toUpperCase()}`;
      return identity === targetIdentity &&
        (String(candidate.matchedInvoiceNumber ?? '').trim() || object(candidate.lateMatch));
    })
  )) {
    return 'This bank deposit was already matched from another B2C day.';
  }
  const match = {
    mode: input.mode,
    reference,
    amount: expectedAmount,
    depositDate,
    depositBatchId: input.depositBatchId,
    bankRowIndex: input.bankRowIndex,
    note,
    matchedAt: now,
    matchedBy: actor.name,
    matchedByUserId: actor.userId,
  };
  transaction.lateBankMatches = [...previousLateMatches, match];
  const bankMatches = [...previousMatches, { mode: input.mode, reference, amount: expectedAmount }];
  transaction.bankMatches = bankMatches;
  const expectedModes = [
    ...(Number(transaction.upiAmount ?? 0) > 0 ? ['UPI'] : []),
    ...(Number(transaction.cardAmount ?? 0) > 0 ? ['CARD'] : []),
  ];
  transaction.bankVerified = expectedModes.every(expected =>
    bankMatches.some(existing => existing.mode === expected));
  transaction.bankTransactionId = bankMatches.length === 1 ? reference : null;
  transaction.bankVerificationStatus = transaction.bankVerified ? 'Matched' : 'Missing bank entry';

  bankRow.matchedInvoiceNumber = input.invoiceNumber;
  bankRow.matchedMode = input.mode;
  bankRow.lateMatch = { ...match, invoiceNumber: input.invoiceNumber, paymentBatchId: input.paymentBatchId };
  const log = Array.isArray(paymentBatch.editLog) ? paymentBatch.editLog : [];
  const change = `${input.invoiceNumber}: late ${input.mode} bank match ${reference || 'without reference'} on ${depositDate}. Note: ${note}`;
  paymentBatch.editLog = [...log, {
    at: now, userId: actor.userId, name: actor.name, role: actor.role,
    action: 'late-bank-match', changes: [change],
  }].slice(-100);
  return null;
}
