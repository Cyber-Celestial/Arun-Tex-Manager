import test from 'node:test';
import assert from 'node:assert/strict';
import { isReconciliationUploaded, reconciliationDate, validateReconciliationChange } from './reconciliation-policy';

const row = (invoiceNumber = 'INV-1') => ({ invoiceNumber, date: '2024-02-29', totalInvoiceAmount: 100,
  type: 'Invoice', paymentMode: 'CASH', cashAmount: 100, upiAmount: 0, cardAmount: 0 });
const batch = (date = '2024-02-29', transactions: unknown[] = []) =>
  ({ date, status: 'Open', transactions, bankRows: [], denominations: {} }) as Record<string, any>;
const state = (...batches: Record<string, any>[]) => ({ batches });
const copy = <T,>(value:T):T => structuredClone(value);

test('business date handles timestamps without timezone drift and rejects invalid calendar dates', () => {
  assert.equal(reconciliationDate('2024-02-29T23:30:00-08:00'), '2024-02-29');
  assert.equal(reconciliationDate('2024-02-29T00:00:00+05:30'), '2024-02-29');
  for (const value of ['2023-02-29', '2024-02-30', '2024-13-01', '', '0000-01-01']) {
    assert.equal(reconciliationDate(value), '');
  }
});
test('any historical date, today and cross-year dates can be created', () => {
  const next=state(batch('1980-01-01'),batch('2024-12-31'),batch('2025-01-01'),batch('2026-10-26'));
  assert.equal(validateReconciliationChange(next,state()),null);
});
test('two timestamps on the same date cannot create two batches', () => {
  const before=state(batch('2024-02-29T00:00:00Z'));
  const next=copy(before);next.batches.push(batch('2024-02-29T23:59:59+05:30'));
  assert.match(validateReconciliationChange(next,before)!,/already exists.*2024-02-29/);
});
test('first successful import receives a server receipt atomically', () => {
  const before=state(batch());const next=copy(before);
  next.batches[0].transactions=[row()];
  next.batches[0].invoiceImport={fileName:'daily.xlsx',id:'untrusted',importedAt:'untrusted'};
  assert.equal(validateReconciliationChange(next,before),null);
  assert.equal(next.batches[0].invoiceImport.fileName,'daily.xlsx');
  assert.notEqual(next.batches[0].invoiceImport.id,'untrusted');
  assert.match(next.batches[0].invoiceImport.importedAt,/^\d{4}-/);
});
test('empty or failed drafts do not count as uploads; later first import remains possible', () => {
  assert.equal(isReconciliationUploaded(batch()),false);
  const before=state(batch());const next=copy(before);
  next.batches[0].transactions=[row()];
  assert.equal(validateReconciliationChange(next,before),null);
  assert.equal(isReconciliationUploaded(next.batches[0]),true);
});
test('legacy populated batches are already uploaded without a receipt', () => {
  const before=state(batch(undefined,[row()]));
  assert.equal(isReconciliationUploaded(before.batches[0]),true);
  const next=copy(before);next.batches[0].transactions.push(row('INV-2'));
  assert.match(validateReconciliationChange(next,before)!,/already been uploaded/);
});
test('different filenames, new receipts, appending and replacing source rows are rejected', () => {
  const before=state(batch(undefined,[row()]));
  before.batches[0].invoiceImport={id:'saved',fileName:'first.xlsx',importedAt:'2024-03-01'};
  for(const mutate of [
    (b:Record<string,any>)=>{b.invoiceImport.fileName='different.xlsx';},
    (b:Record<string,any>)=>{b.invoiceImport.id='second';},
    (b:Record<string,any>)=>{delete b.invoiceImport;},
    (b:Record<string,any>)=>{b.transactions.push(row());},
    (b:Record<string,any>)=>{b.transactions=[row('REPLACED')];},
    (b:Record<string,any>)=>{b.transactions=[];},
  ]) {
    const next=copy(before);mutate(next.batches[0]);
    assert.match(validateReconciliationChange(next,before)!,/already been uploaded/);
  }
});
test('bank statements, payment allocation, denomination and matching changes remain valid', () => {
  const before=state(batch(undefined,[row()]));const next=copy(before);
  next.batches[0].transactions[0]={...row(),paymentMode:'SPLIT',cashAmount:40,upiAmount:60,bankVerified:true};
  next.batches[0].bankRows=[{date:'2024-02-29',depositAmount:60,reference:'REF',mode:'UPI'}];
  next.batches[0].denominations={'20':2};
  assert.equal(validateReconciliationChange(next,before),null);
  assert.equal(next.batches[0].invoiceImport,undefined);
});
test('cannot rename, remove or shift an uploaded reconciliation to bypass the rule', () => {
  const before=state({...batch(undefined,[row()]),id:'original'});
  assert.match(validateReconciliationChange(state(),before)!,/cannot be removed/);
  const renamed=copy(before);renamed.batches[0].date='2024-03-01';
  assert.match(validateReconciliationChange(renamed,before)!,/cannot be changed/);
  const identity=copy(before);identity.batches[0].id='replacement';
  assert.match(validateReconciliationChange(identity,before)!,/identity/);
});
test('unchanged legacy duplicate dates do not block unrelated edits but cannot gain another upload', () => {
  const before=state(batch(undefined,[row()]),batch('2024-02-29T10:00:00Z'));
  const next=copy(before);next.batches[0].denominations={'100':1};
  next.batches.push(batch('2024-03-01'));
  assert.equal(validateReconciliationChange(next,before),null);
  const duplicateImport=copy(before);duplicateImport.batches[1].transactions=[row('INV-2')];
  assert.match(validateReconciliationChange(duplicateImport,before)!,/second invoice upload/);
});
test('existing legacy duplicate uploads are preserved, not silently merged or deleted', () => {
  const before=state(batch(undefined,[row()]),batch(undefined,[row('LEGACY-2')]));
  const next=copy(before);next.batches[1].denominations={'100':1};
  assert.equal(validateReconciliationChange(next,before),null);
  const newDuplicate=copy(before);newDuplicate.batches.push(batch());
  assert.match(validateReconciliationChange(newDuplicate,before)!,/already exists/);
});
test('invalid new dates and empty success receipts are rejected without blocking unchanged legacy dates', () => {
  assert.match(validateReconciliationChange(state(batch('2023-02-29')),state())!,/valid.*date/);
  const empty=state(batch());empty.batches[0].invoiceImport={fileName:'empty.xlsx'};
  assert.match(validateReconciliationChange(empty,state())!,/must contain invoice/);
  const legacy=state(batch('legacy unknown',[row()]));
  const next=copy(legacy);next.batches.push(batch('2025-01-01'));
  assert.equal(validateReconciliationChange(next,legacy),null);
});

test('an invoice number cannot appear twice in one reconciliation or across reconciliations', () => {
  const twice=state(batch('2024-02-29',[row('A1'),row('a1 ')]));
  assert.match(validateReconciliationChange(twice,state(batch('2024-02-29')))!,/A1.*only once/);
  const before=state(batch('2024-02-28',[row('B1')]),batch('2024-02-29'));
  const next=copy(before);next.batches[1].transactions=[row('b1')];
  assert.match(validateReconciliationChange(next,before)!,/B1.*only once/);
  const fresh=copy(before);fresh.batches[1].transactions=[row('B2')];
  assert.equal(validateReconciliationChange(fresh,before),null);
});
test('legacy repeated invoice numbers may stay but cannot grow', () => {
  const legacy=state(batch('2024-02-29',[row('L1'),row('L1')]));
  assert.equal(validateReconciliationChange(copy(legacy),legacy),null);
  const grown=copy(legacy);grown.batches.push(batch('2024-03-01',[row('L1')]));
  assert.match(validateReconciliationChange(grown,legacy)!,/L1.*only once/);
});
