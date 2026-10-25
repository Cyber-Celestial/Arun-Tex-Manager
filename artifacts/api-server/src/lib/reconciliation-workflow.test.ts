import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBatchWorkflow, countedCash, expectedCash, onlinePending, settleBatch, type Actor } from './reconciliation-workflow';

const billing: Actor = { userId: 'b1', name: 'Bela', role: 'billing' };
const admin: Actor = { userId: 'a1', name: 'Arun', role: 'admin' };
const NOW = '2026-10-25T10:00:00.000Z';
const tx = (over: Record<string, unknown> = {}) => ({ invoiceNumber: 'C1', date: '2026-10-24', totalInvoiceAmount: 500, type: 'Invoice', paymentMode: 'CASH', cashAmount: 500, upiAmount: 0, cardAmount: 0, bankVerified: true, ...over });
const upi = (verified: boolean) => tx({ invoiceNumber: 'U1', totalInvoiceAmount: 700, paymentMode: 'UPI', cashAmount: 0, upiAmount: 700, bankVerified: verified });
const batch = (over: Record<string, unknown> = {}) => ({ id: 'b', date: '2026-10-24', status: 'Open', transactions: [tx(), upi(true)], bankRows: [], denominations: { '500': 1 }, invoiceImport: { fileName: 'f' }, ...over }) as Record<string, any>;
const copy = <T,>(v: T): T => structuredClone(v);
const run = (next: Record<string, any>, prev: Record<string, any> | undefined, actor: Actor) =>
  applyBatchWorkflow([next], prev ? [prev] : [], actor, NOW);

test('cash maths: returns reduce expected cash and notes are counted by value', () => {
  const b = batch({ transactions: [tx(), tx({ invoiceNumber: 'R1', type: 'Return', totalInvoiceAmount: 100, cashAmount: 0 })] });
  assert.equal(expectedCash(b), 400);
  assert.equal(countedCash({ '200': 2, '100': 1, '1': 3 }), 503);
  assert.equal(onlinePending(batch({ transactions: [upi(false)] })), true);
  assert.equal(onlinePending(batch()), false);
});

test('billing submits a balanced cash batch; stamps and log are written by the server', () => {
  const prev = batch(); const next = copy(prev);
  next.billingSubmitted = true; next.billingSubmittedBy = 'forged'; next.editLog = [{ action: 'forged' }]; next.status = 'Submitted';
  assert.equal(run(next, prev, billing), null);
  assert.equal(next.billingSubmitted, true);
  assert.equal(next.billingSubmittedBy, 'Bela');
  assert.equal(next.status, 'Open');
  assert.deepEqual(next.editLog.map((e: any) => e.action), ['billing-submit']);
});

test('submit needs a balanced count and an uploaded workbook', () => {
  const prev = batch({ denominations: { '500': 2 } }); const next = copy(prev); next.billingSubmitted = true;
  assert.match(run(next, prev, billing)!.error, /Cash counted/);
  const empty = batch({ transactions: [], invoiceImport: undefined }); const e2 = copy(empty); e2.billingSubmitted = true;
  assert.match(run(e2, empty, billing)!.error, /Upload the invoice workbook/);
});

test('billing cannot change a submitted batch, approve, or withdraw the submission', () => {
  const prev = batch({ billingSubmitted: true }); 
  const edited = copy(prev); edited.transactions[0].cashAmount = 400;
  assert.equal(run(edited, prev, billing)!.status, 403);
  const approve = copy(prev); approve.adminApproved = true;
  assert.match(run(approve, prev, billing)!.error, /Only an Admin/);
  const withdraw = copy(prev); withdraw.billingSubmitted = false;
  assert.match(run(withdraw, prev, billing)!.error, /cannot be withdrawn/);
});

test('admin cannot approve before Billing submits; approval locks only when online payments are verified', () => {
  const open = batch(); const early = copy(open); early.adminApproved = true;
  assert.match(run(early, open, admin)!.error, /Billing must submit/);

  const submittedPending = batch({ billingSubmitted: true, transactions: [tx(), upi(false)] });
  const waiting = copy(submittedPending); waiting.adminApproved = true;
  assert.equal(run(waiting, submittedPending, admin), null);
  assert.equal(waiting.adminApproved, true);
  assert.equal(waiting.status, 'Open');

  const submitted = batch({ billingSubmitted: true });
  const locked = copy(submitted); locked.adminApproved = true;
  assert.equal(run(locked, submitted, admin), null);
  assert.equal(locked.status, 'Submitted');
  assert.deepEqual(locked.editLog.map((e: any) => e.action), ['admin-approve', 'lock']);
});

test('settleBatch locks when the last bank match arrives', () => {
  const b = batch({ billingSubmitted: true, adminApproved: true, transactions: [tx(), upi(false)] });
  assert.equal(settleBatch(b, admin, NOW), false);
  b.transactions[1].bankVerified = true;
  assert.equal(settleBatch(b, { userId: 'x', name: 'Accounts', role: 'accounts' }, NOW), true);
  assert.equal(b.status, 'Submitted');
  assert.equal(b.editLog.at(-1).action, 'lock');
});

test('admin edits a submitted batch directly; the edit is logged and clears the approval', () => {
  const prev = batch({ billingSubmitted: true, adminApproved: true, transactions: [tx(), upi(false)], denominations: { '500': 1 } });
  const next = copy(prev); next.transactions[0].cashAmount = 450; next.transactions[0].totalInvoiceAmount = 450; next.denominations = { '200': 2, '50': 1 };
  assert.equal(run(next, prev, admin), null);
  assert.equal(next.adminApproved, false);
  const actions = next.editLog.map((e: any) => e.action);
  assert.deepEqual(actions, ['edit', 'approval-cleared']);
  assert.ok(next.editLog[0].changes.includes('C1: cash 500 → 450'));
  assert.ok(next.editLog[0].changes.includes('₹500 notes: 1 → 0'));
  assert.equal(next.editLog[0].name, 'Arun');
});

test('billing edits before submission are not logged; admin import is summarised', () => {
  const prev = batch(); const edited = copy(prev); edited.transactions[0].paymentMode = 'CARD';
  assert.equal(run(edited, prev, billing), null);
  assert.deepEqual(edited.editLog, []);
  const empty = batch({ transactions: [], invoiceImport: undefined }); const imported = copy(batch());
  assert.equal(run(imported, empty, admin), null);
  assert.deepEqual(imported.editLog[0].changes, ['Imported 2 invoices and returns']);
});

test('locked batches are skipped and keep their history', () => {
  const prev = batch({ status: 'Submitted', billingSubmitted: true, adminApproved: true, editLog: [{ action: 'lock' }] });
  const next = copy(prev);
  assert.equal(run(next, prev, admin), null);
  assert.deepEqual(next, prev);
});
