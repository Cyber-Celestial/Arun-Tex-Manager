import { reconciliationDate } from './reconciliation-policy';
import { cents, classifyBankMode, object } from './reconciliation-bank';

type RecordValue = Record<string, unknown>;
type Mode = 'UPI' | 'CARD';

export type DepositRef = { batchId: string; rowIndex: number };
export type ManualReconcileInput =
  | { action: 'club'; paymentBatchId: string; invoiceNumber: string; mode: Mode; deposits: DepositRef[]; note: string }
  | { action: 'invoice-note'; paymentBatchId: string; invoiceNumber: string; mode: Mode; note: string }
  | { action: 'row-note'; depositBatchId: string; bankRowIndex: number; note: string };

export type ManualActor = { userId: string; name: string; role: string };

const isAccounted = (row: RecordValue) =>
  Boolean(String(row.matchedInvoiceNumber ?? '').trim()) || object(row.lateMatch) || object(row.manualNote);

export function unaccountedBankRows(batch: RecordValue): number {
  const rows = Array.isArray(batch.bankRows) ? batch.bankRows : [];
  return rows.filter(row => object(row) && !isAccounted(row)).length;
}

const allocation = (transaction: RecordValue, mode: Mode) =>
  Number(mode === 'UPI' ? transaction.upiAmount : transaction.cardAmount);

function modeAlreadyHandled(transaction: RecordValue, mode: Mode): boolean {
  const lists = [transaction.bankMatches, transaction.lateBankMatches];
  return lists.some(list => Array.isArray(list) && list.some(match => object(match) && match.mode === mode));
}

function findTransaction(batch: RecordValue, invoiceNumber: string): RecordValue | undefined {
  return (Array.isArray(batch.transactions) ? batch.transactions : [])
    .filter(object).find(row => String(row.invoiceNumber ?? '') === invoiceNumber);
}

function refreshVerification(transaction: RecordValue): void {
  const matches = Array.isArray(transaction.bankMatches) ? transaction.bankMatches.filter(object) : [];
  const expected = [
    ...(Number(transaction.upiAmount ?? 0) > 0 ? ['UPI'] : []),
    ...(Number(transaction.cardAmount ?? 0) > 0 ? ['CARD'] : []),
  ];
  transaction.bankVerified = expected.every(mode => matches.some(match => match.mode === mode));
  transaction.bankTransactionId = matches.length === 1 ? String(matches[0].reference ?? '') || null : null;
  const noted = Array.isArray(transaction.lateBankMatches) && transaction.lateBankMatches.some(match => object(match) && match.kind === 'note');
  transaction.bankVerificationStatus = transaction.bankVerified ? (noted ? 'Noted by Admin' : 'Matched') : 'Missing bank entry';
}

function logChange(batch: RecordValue, actor: ManualActor, now: string, action: string, change: string): void {
  const log = Array.isArray(batch.editLog) ? batch.editLog : [];
  batch.editLog = [...log, { at: now, userId: actor.userId, name: actor.name, role: actor.role, action, changes: [change] }].slice(-100);
}

/** Records a manual bank reconciliation: clubbed deposits, a note-only invoice, or a noted statement row. */
export function applyManualReconciliation(b2c: RecordValue, input: ManualReconcileInput, actor: ManualActor, now: string): string | null {
  const noteRequiresAdmin = input.action !== 'club';
  if (actor.role !== 'admin' && !(actor.role === 'accounts' && !noteRequiresAdmin)) {
    return noteRequiresAdmin ? 'Only an Admin can reconcile with a note.' : 'Only Accounts or an Admin can club deposits.';
  }
  const note = input.note.trim();
  if (!note || note.length > 500) return 'Add a note of up to 500 characters.';
  if (!Array.isArray(b2c.batches)) return 'B2C data is not available.';
  const batches = b2c.batches.filter(object);
  const batchById = (id: string) => batches.find(batch => String(batch.id ?? '') === id);

  if (input.action === 'row-note') {
    const batch = batchById(input.depositBatchId);
    const row = batch && Array.isArray(batch.bankRows) ? batch.bankRows[input.bankRowIndex] : undefined;
    if (!batch || !object(row)) return 'The selected bank deposit could not be found.';
    if (isAccounted(row)) return 'This bank deposit is already matched.';
    row.manualNote = { note, by: actor.name, byUserId: actor.userId, at: now };
    logChange(batch, actor, now, 'bank-row-note',
      `${reconciliationDate(row.date)} ${String(row.mode ?? '')} deposit ${String(row.reference ?? '') || 'without reference'} noted. Note: ${note}`);
    return null;
  }

  const paymentBatch = batchById(input.paymentBatchId);
  const transaction = paymentBatch && findTransaction(paymentBatch, input.invoiceNumber);
  if (!paymentBatch || !transaction) return 'The selected payment could not be found.';
  if (transaction.type === 'Return') return 'Sales returns cannot be matched to a bank deposit.';
  const expected = allocation(transaction, input.mode);
  if (!Number.isFinite(expected) || expected <= 0) return `This invoice has no ${input.mode} amount.`;
  if (modeAlreadyHandled(transaction, input.mode)) return `The ${input.mode} payment is already matched.`;
  const previous = Array.isArray(transaction.lateBankMatches) ? transaction.lateBankMatches.filter(object) : [];

  if (input.action === 'invoice-note') {
    const entry = { kind: 'note', mode: input.mode, reference: '', amount: expected, note, matchedAt: now, matchedBy: actor.name, matchedByUserId: actor.userId };
    transaction.lateBankMatches = [...previous, entry];
    transaction.bankMatches = [...(Array.isArray(transaction.bankMatches) ? transaction.bankMatches : []), { mode: input.mode, reference: '', amount: expected }];
    refreshVerification(transaction);
    logChange(paymentBatch, actor, now, 'bank-invoice-note', `${input.invoiceNumber}: ${input.mode} accepted without a bank deposit. Note: ${note}`);
    return null;
  }

  if (input.deposits.length < 2) return 'Choose at least two deposits to club.';
  const invoiceDate = reconciliationDate(transaction.date);
  const rows: RecordValue[] = [];
  let total = 0;
  for (const ref of input.deposits) {
    const depositBatch = batchById(ref.batchId);
    const row = depositBatch && Array.isArray(depositBatch.bankRows) ? depositBatch.bankRows[ref.rowIndex] : undefined;
    if (!object(row)) return 'A selected bank deposit could not be found.';
    if (rows.includes(row)) return 'The same deposit was chosen twice.';
    if (isAccounted(row)) return 'A selected bank deposit is already matched.';
    if (classifyBankMode(row) !== input.mode) return 'Every deposit must be the same mode as the payment.';
    const depositDate = reconciliationDate(row.date);
    if (!invoiceDate || !depositDate || depositDate < invoiceDate) return 'A deposit cannot be dated before the invoice.';
    rows.push(row);
    total += cents(Number(row.depositAmount));
  }
  if (total !== cents(expected)) return 'The selected deposits must add up exactly to the payment amount.';

  const references = rows.map(row => String(row.reference ?? '').trim()).filter(Boolean);
  const entry = {
    kind: 'club', mode: input.mode, reference: references.join(', '), references, amount: expected,
    note, matchedAt: now, matchedBy: actor.name, matchedByUserId: actor.userId,
  };
  transaction.lateBankMatches = [...previous, entry];
  transaction.bankMatches = [...(Array.isArray(transaction.bankMatches) ? transaction.bankMatches : []),
    { mode: input.mode, reference: entry.reference, amount: expected }];
  rows.forEach(row => {
    row.matchedInvoiceNumber = input.invoiceNumber;
    row.matchedMode = input.mode;
    row.lateMatch = { ...entry, invoiceNumber: input.invoiceNumber, paymentBatchId: input.paymentBatchId, depositDate: reconciliationDate(row.date) };
  });
  refreshVerification(transaction);
  logChange(paymentBatch, actor, now, 'bank-club',
    `${input.invoiceNumber}: ${input.mode} payment clubbed from ${rows.length} deposits (${references.join(', ') || 'no references'}). Note: ${note}`);
  return null;
}
