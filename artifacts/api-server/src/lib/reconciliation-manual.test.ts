import test from 'node:test';
import assert from 'node:assert/strict';
import { applyManualReconciliation, unaccountedBankRows } from './reconciliation-manual';
import { matchOnlinePayments } from './reconciliation-bank';
import { settleBatch } from './reconciliation-workflow';

const admin = { userId: 'u1', name: 'Owner', role: 'admin' };
const accounts = { userId: 'u2', name: 'Acc', role: 'accounts' };
const deposit = (over: Record<string, unknown> = {}) => ({ date: '2026-10-24', narration: 'UPI-1@AXL', reference: 'R1', depositAmount: 100, mode: 'UPI', matchedInvoiceNumber: '', ...over });

const state = () => ({
  batches: [{
    id: 'b1', date: '2026-10-24', status: 'Open', billingSubmitted: true, adminApproved: true, editLog: [],
    transactions: [{ invoiceNumber: 'S1', date: '2026-10-24', type: 'Invoice', totalInvoiceAmount: 600, upiAmount: 600, cardAmount: 0, cashAmount: 0 }],
    bankRows: [deposit(), deposit({ reference: 'R2', depositAmount: 500 })],
  }],
});
const club = { action: 'club' as const, paymentBatchId: 'b1', invoiceNumber: 'S1', mode: 'UPI' as const, note: 'Test then full payment' };

test('clubbing two deposits settles one invoice and marks both rows', () => {
  const b2c = state();
  const error = applyManualReconciliation(b2c, { ...club, deposits: [{ batchId: 'b1', rowIndex: 0 }, { batchId: 'b1', rowIndex: 1 }] }, accounts, 'now');
  assert.equal(error, null);
  const [transaction] = b2c.batches[0].transactions as Record<string, unknown>[];
  assert.equal(transaction.bankVerified, true);
  assert.equal(transaction.bankTransactionId, 'R1, R2');
  assert.equal(unaccountedBankRows(b2c.batches[0]), 0);
  matchOnlinePayments(b2c, 'accounts');
  assert.equal(transaction.bankVerified, true);
  assert.equal(settleBatch(b2c.batches[0], accounts, 'now'), true);
});

test('clubbed deposits must add up, differ and match the mode', () => {
  const two = [{ batchId: 'b1', rowIndex: 0 }, { batchId: 'b1', rowIndex: 1 }];
  const short = state(); (short.batches[0].bankRows[1] as Record<string, unknown>).depositAmount = 499;
  assert.match(String(applyManualReconciliation(short, { ...club, deposits: two }, admin, 'now')), /add up/);
  assert.match(String(applyManualReconciliation(state(), { ...club, deposits: [two[0], two[0]] }, admin, 'now')), /twice/);
  assert.match(String(applyManualReconciliation(state(), { ...club, deposits: [two[0]] }, admin, 'now')), /at least two/);
  const card = state(); (card.batches[0].bankRows[1] as Record<string, unknown>).mode = 'CARD';
  assert.match(String(applyManualReconciliation(card, { ...club, deposits: two }, admin, 'now')), /same mode/);
  const early = state(); (early.batches[0].bankRows[0] as Record<string, unknown>).date = '2026-10-23';
  assert.match(String(applyManualReconciliation(early, { ...club, deposits: two }, admin, 'now')), /before the invoice/);
});

test('a note is required, and a matched deposit cannot be reused', () => {
  const two = [{ batchId: 'b1', rowIndex: 0 }, { batchId: 'b1', rowIndex: 1 }];
  assert.match(String(applyManualReconciliation(state(), { ...club, deposits: two, note: '  ' }, admin, 'now')), /note/);
  const b2c = state();
  assert.equal(applyManualReconciliation(b2c, { ...club, deposits: two }, admin, 'now'), null);
  assert.match(String(applyManualReconciliation(b2c, { ...club, deposits: two }, admin, 'now')), /already matched/);
});

test('only an Admin can use notes; billing cannot reconcile', () => {
  const note = { action: 'invoice-note' as const, paymentBatchId: 'b1', invoiceNumber: 'S1', mode: 'UPI' as const, note: 'Paid by cheque' };
  assert.match(String(applyManualReconciliation(state(), note, accounts, 'now')), /Admin/);
  assert.ok(applyManualReconciliation(state(), { ...club, deposits: [] }, { ...admin, role: 'billing' }, 'now'));
  const b2c = state();
  assert.equal(applyManualReconciliation(b2c, note, admin, 'now'), null);
  const [transaction] = b2c.batches[0].transactions as Record<string, unknown>[];
  assert.equal(transaction.bankVerified, true);
  assert.equal(transaction.bankVerificationStatus, 'Noted by Admin');
});

test('a noted statement row counts as accounted and a day cannot lock before that', () => {
  const b2c = state();
  const batch = b2c.batches[0] as Record<string, unknown>;
  matchOnlinePayments(b2c, 'admin');
  assert.equal(unaccountedBankRows(batch), 2);
  assert.equal(settleBatch(batch, admin, 'now'), false);
  const note = { action: 'row-note' as const, depositBatchId: 'b1', bankRowIndex: 0, note: 'Other inward from another shop' };
  assert.equal(applyManualReconciliation(b2c, note, admin, 'now'), null);
  assert.match(String(applyManualReconciliation(b2c, note, admin, 'now')), /already matched/);
  assert.equal(unaccountedBankRows(batch), 1);
});
