import test from 'node:test';
import assert from 'node:assert/strict';
import { batchStage, emptyReconciliation, onlinePaymentCounts, reconciliationLabel, reconciliationUploaded } from './reconciliation';

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

test('batch stage follows submit, approval and lock', () => {
  assert.equal(batchStage({}).label,'Open');
  assert.equal(batchStage({billingSubmitted:true}).label,'Cash submitted');
  assert.equal(batchStage({billingSubmitted:true,adminApproved:true}).label,'Approved · awaiting bank');
  assert.equal(batchStage({billingSubmitted:true,adminApproved:true,status:'Submitted'}).label,'Locked');
  assert.equal(batchStage({status:'Submitted'}).label,'Locked');
});
test('online payment counts ignore cash and returns', () => {
  const rows=[{upiAmount:5,bankVerified:true},{cardAmount:7,bankVerified:false},{cashAmount:9},{type:'Return',upiAmount:3}];
  assert.deepEqual(onlinePaymentCounts(rows),{verified:1,total:2});
});
