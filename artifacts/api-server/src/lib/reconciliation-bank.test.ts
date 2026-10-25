import test from 'node:test';
import assert from 'node:assert/strict';
import { appendBankRows, sanitizeBankRows, validateB2cRoleChange } from './reconciliation-bank';

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
