import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyReconciliation, oneEntryPerInvoice, reconciliationLabel, reconciliationUploaded } from './reconciliation';

test('new dated batches are empty, independently identified and not uploaded', () => {
  const first=emptyReconciliation('2024-02-29'),second=emptyReconciliation('2024-02-29');
  assert.equal(first.date,'2024-02-29');
  assert.notEqual(first.id,second.id);
  assert.equal(reconciliationUploaded(first),false);
});
test('legacy transactions and persisted import receipts both count as uploaded', () => {
  assert.equal(reconciliationUploaded({transactions:[{invoiceNumber:'LEGACY'}]}),true);
  assert.equal(reconciliationUploaded({transactions:[],invoiceImport:{id:'saved'}}),true);
});
test('labels include the year without shifting midnight timestamps', () => {
  assert.match(reconciliationLabel('2024-02-29T00:00:00+05:30'),/29 Feb 2024/);
  assert.match(reconciliationLabel('2025-01-01'),/01 Jan 2025/);
});

test('item lines of one invoice collapse to the first line; returns follow the same rule', () => {
  const lines=[{invoiceNumber:'INV-1',totalInvoiceAmount:500},{invoiceNumber:'INV-1',totalInvoiceAmount:500},{invoiceNumber:' inv-1',totalInvoiceAmount:500},{invoiceNumber:'INV-2',totalInvoiceAmount:70},{invoiceNumber:'RET-1',totalInvoiceAmount:20},{invoiceNumber:'RET-1',totalInvoiceAmount:20}];
  const result=oneEntryPerInvoice(lines);
  assert.deepEqual(result.rows.map(r=>r.invoiceNumber),['INV-1','INV-2','RET-1']);
  assert.equal(result.merged,3);
  assert.deepEqual(result.conflicts,[]);
});
test('lines of one invoice with different totals are reported, first line wins', () => {
  const result=oneEntryPerInvoice([{invoiceNumber:'INV-9',totalInvoiceAmount:100},{invoiceNumber:'INV-9',totalInvoiceAmount:40}]);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].totalInvoiceAmount,100);
  assert.deepEqual(result.conflicts,['INV-9']);
});
