import test from 'node:test';
import assert from 'node:assert/strict';
import { appendBankRows, applyLateBankMatch, matchOnlinePayments, sanitizeBankRows, validateB2cRoleChange, validateLateMatchProtection } from './reconciliation-bank';

const row = (over: Record<string, unknown> = {}) => ({ date: '2026-10-24', narration: 'UPI-1@AXL', reference: 'R1', depositAmount: 600, mode: 'UPI', ...over });

test('sanitizeBankRows keeps valid deposits and clears any match result', () => {
  const rows = sanitizeBankRows([row({ matchedInvoiceNumber: 'X9', extra: 1 })]);
  assert.deepEqual(rows, [{ date: '2026-10-24', narration: 'UPI-1@AXL', reference: 'R1', depositAmount: 600, mode: 'UPI', matchedInvoiceNumber: '' }]);
});

test('sanitizeBankRows rejects empty, bad dates, non-positive amounts and unknown modes', () => {
  assert.equal(sanitizeBankRows([]), null);
  assert.equal(sanitizeBankRows('x'), null);
  assert.equal(sanitizeBankRows([row({ date: '2026-02-30' })]), null);
  assert.equal(sanitizeBankRows([row({ depositAmount: 0 })]), null);
  assert.equal(sanitizeBankRows([row({ depositAmount: 'abc' })]), null);
  assert.equal(sanitizeBankRows([row({ mode: 'CHEQUE' })]), null);
  assert.equal(sanitizeBankRows([row(), 5]), null);
});

test('sanitizeBankRows ignores non-UPI and non-card transactions', () => {
  const rows = sanitizeBankRows([
    row(),
    row({ mode: 'CASH', narration: 'Cash counter deposit', reference: 'CASH-1' }),
    row({ mode: 'CHEQUE', narration: 'Cheque credit', reference: 'CHQ-1' }),
  ]);
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0].mode, 'UPI');
  assert.equal(sanitizeBankRows([row({ mode: 'CASH', narration: 'Cash deposit' })]), null);
});

test('appendBankRows skips a reference already on file but keeps reference-less repeats', () => {
  const first = appendBankRows([], sanitizeBankRows([row()])!);
  assert.equal(first.added, 1);
  const again = appendBankRows(first.rows, sanitizeBankRows([row(), row({ reference: 'R2', depositAmount: 400, mode: 'CARD' })])!);
  assert.equal(again.added, 1);
  assert.equal(again.rows.length, 2);
  const noRef = appendBankRows([], sanitizeBankRows([row({ reference: '' }), row({ reference: '' })])!);
  assert.equal(noRef.added, 2);
});

test('billing cannot add, change or remove bank statement rows', () => {
  const stored = { batches: [{ date: '2026-10-24', bankRows: [{ ...row(), matchedInvoiceNumber: 'S1' }] }] };
  assert.equal(validateB2cRoleChange('billing', structuredClone(stored), stored), null);
  const rematched = structuredClone(stored);
  rematched.batches[0].bankRows[0].matchedInvoiceNumber = '';
  assert.equal(validateB2cRoleChange('billing', rematched, stored), null);
  const edited = structuredClone(stored);
  edited.batches[0].bankRows[0].depositAmount = 1;
  assert.match(String(validateB2cRoleChange('billing', edited, stored)), /Accounts or Admin/);
  const added = structuredClone(stored);
  (added.batches[0].bankRows as unknown[]).push(row({ reference: 'R2' }));
  assert.ok(validateB2cRoleChange('billing', added, stored));
  const newBatch = { batches: [...stored.batches, { date: '2026-10-25', bankRows: [row()] }] };
  assert.ok(validateB2cRoleChange('billing', newBatch, stored));
  assert.equal(validateB2cRoleChange('admin', edited, stored), null);
});

const lateState = () => ({
  batches: [
    {
      id: 'payment-day', date: '2026-10-24', status: 'Submitted', billingSubmitted: true,
      adminApproved: true, denominations: { '500': 1 }, editLog: [],
      transactions: [{
        invoiceNumber: 'INV-24', date: '2026-10-24', type: 'Invoice',
        upiAmount: 600, cardAmount: 0, bankMatches: [], bankVerified: false,
      }],
      bankRows: [],
    },
    {
      id: 'deposit-day', date: '2026-10-25', status: 'Open',
      transactions: [], bankRows: [row({ date: '2026-10-25', reference: 'LATE-1' })],
    },
  ],
});

const lateInput = {
  paymentBatchId: 'payment-day', invoiceNumber: 'INV-24', mode: 'UPI' as const,
  depositBatchId: 'deposit-day', bankRowIndex: 0, note: 'Bank credited one day later.',
};
const admin = { userId: 'admin-1', name: 'Admin One', role: 'admin' };

test('Admin late match records the note, actor and bank details without unlocking the batch', () => {
  const data = lateState();
  assert.equal(applyLateBankMatch(data, lateInput, admin, '2026-10-25T10:00:00.000Z'), null);
  const payment = data.batches[0];
  const deposit = data.batches[1].bankRows[0] as Record<string, unknown>;
  const transaction = payment.transactions[0] as Record<string, any>;
  assert.equal(payment.status, 'Submitted');
  assert.deepEqual(payment.denominations, { '500': 1 });
  assert.equal(transaction.bankVerified, true);
  assert.equal(transaction.lateBankMatches[0].matchedByUserId, 'admin-1');
  assert.equal(transaction.lateBankMatches[0].note, lateInput.note);
  assert.equal(deposit.matchedInvoiceNumber, 'INV-24');
  assert.equal((deposit.lateMatch as Record<string, unknown>).note, lateInput.note);
  assert.match(String((payment.editLog as any[])[0].changes[0]), /Bank credited one day later/);

  matchOnlinePayments(data, 'admin');
  assert.equal((payment.transactions[0] as Record<string, any>).bankVerified, true);
  assert.equal((payment.transactions[0] as Record<string, any>).bankMatches.length, 1);
});

test('late matching is Admin-only, requires a note, and cannot reuse a deposit', () => {
  const roleLimited = lateState();
  assert.match(String(applyLateBankMatch(roleLimited, lateInput, { ...admin, role: 'accounts' }, 'now')), /Only an Admin/);
  const noNote = lateState();
  assert.match(String(applyLateBankMatch(noNote, { ...lateInput, note: '   ' }, admin, 'now')), /Add a note/);

  const data = lateState();
  assert.equal(applyLateBankMatch(data, lateInput, admin, 'now'), null);
  assert.match(String(applyLateBankMatch(data, { ...lateInput, invoiceNumber: 'INV-24' }, admin, 'now')), /already matched/);
});

test('ordinary B2C saves cannot forge, edit or remove late-match audit records', () => {
  const previous: any = lateState();
  const next: any = structuredClone(previous);
  assert.equal(validateLateMatchProtection(next, previous), null);
  assert.equal(applyLateBankMatch(next, lateInput, admin, 'now'), null);
  assert.match(String(validateLateMatchProtection(next, previous)), /Admin late-match action/);

  const saved: any = structuredClone(next);
  assert.equal(validateLateMatchProtection(saved, next), null);
  saved.batches[0].transactions[0].lateBankMatches[0].note = 'Edited through normal save';
  assert.match(String(validateLateMatchProtection(saved, next)), /Admin late-match action/);
  const removed: any = structuredClone(next);
  delete removed.batches[0].transactions[0].lateBankMatches;
  delete removed.batches[1].bankRows[0].lateMatch;
  assert.match(String(validateLateMatchProtection(removed, next)), /Admin late-match action/);
  const alteredDeposit: any = structuredClone(next);
  alteredDeposit.batches[1].bankRows[0].depositAmount = 900;
  assert.match(String(validateLateMatchProtection(alteredDeposit, next)), /Admin late-match action/);
  const alteredPayment: any = structuredClone(next);
  alteredPayment.batches[0].transactions[0].upiAmount = 900;
  assert.match(String(validateLateMatchProtection(alteredPayment, next)), /Admin late-match action/);
});

test('late matching rejects same-day, wrong-mode and wrong-amount deposits', () => {
  const sameDay = lateState();
  (sameDay.batches[1].bankRows[0] as Record<string, unknown>).date = '2026-10-24';
  assert.match(String(applyLateBankMatch(sameDay, lateInput, admin, 'now')), /dated after/);

  const wrongMode = lateState();
  (wrongMode.batches[1].bankRows[0] as Record<string, unknown>).mode = 'CARD';
  assert.match(String(applyLateBankMatch(wrongMode, lateInput, admin, 'now')), /mode does not match/);

  const wrongAmount = lateState();
  (wrongAmount.batches[1].bankRows[0] as Record<string, unknown>).depositAmount = 599;
  assert.match(String(applyLateBankMatch(wrongAmount, lateInput, admin, 'now')), /amount must exactly match/);
});

test('a duplicate referenced deposit already matched on another date cannot be reused', () => {
  const data: any = lateState();
  data.batches.push({
    id: 'duplicate-import', date: '2026-10-25', transactions: [],
    bankRows: [row({ date: '2026-10-25', reference: 'LATE-1', matchedInvoiceNumber: 'INV-OTHER' })],
  });
  assert.match(String(applyLateBankMatch(data, lateInput, admin, 'now')), /already matched from another/);
});

test('a repeated reference-less deposit cannot be matched from another B2C day', () => {
  const data: any = lateState();
  data.batches[1].bankRows[0].reference = '';
  data.batches.push({
    id: 'duplicate-import', date: '2026-10-25', transactions: [],
    bankRows: [row({ date: '2026-10-25', reference: '', matchedInvoiceNumber: 'INV-OTHER' })],
  });
  assert.match(String(applyLateBankMatch(data, lateInput, admin, 'now')), /already matched from another/);
});

test('same-day automatic UPI and card matching still works', () => {
  const data: any = {
    batches: [{
      date: '2026-10-24',
      transactions: [{
        invoiceNumber: 'SAME-DAY', date: '2026-10-24', upiAmount: 600, cardAmount: 250,
        bankVerified: false,
      }],
      bankRows: [
        row({ date: '2026-10-24', reference: 'UPI-1', depositAmount: 600 }),
        row({ date: '2026-10-24', reference: 'CARD-1', mode: 'CARD', narration: 'POS terminal', depositAmount: 250 }),
      ],
    }],
  };
  matchOnlinePayments(data, 'accounts');
  assert.equal(data.batches[0].transactions[0].bankVerified, true);
  assert.deepEqual(data.batches[0].transactions[0].bankMatches.map((match: any) => match.mode), ['UPI', 'CARD']);
});
