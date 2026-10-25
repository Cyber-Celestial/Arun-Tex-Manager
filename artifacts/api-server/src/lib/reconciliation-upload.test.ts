import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUpload, cleanUploadRows } from './reconciliation-upload';
import { removeB2cDay } from './reconciliation-delete';

const billing = { userId: 'b1', name: 'Bela', role: 'billing' };
const admin = { userId: 'a1', name: 'Arun', role: 'admin' };
const NOW = '2026-10-25T10:00:00.000Z';
const row = (n: string, date = '2026-10-24', over: Record<string, unknown> = {}) =>
  ({ invoiceNumber: n, date, totalInvoiceAmount: 100, type: 'Invoice', paymentMode: 'CASH', cashAmount: 100, upiAmount: 0, cardAmount: 0, bankVerified: true, ...over });
const input = (rows: unknown[], over: Record<string, unknown> = {}) => ({ date: '2026-10-24', fileName: 'day.xlsx', transactions: rows, ...over });
const ok = (r: any) => { assert.ok('data' in r, JSON.stringify(r)); return r; };
const day = (over: Record<string, unknown> = {}) => ({ id: 'd1', date: '2026-10-24', status: 'Open', transactions: [row('OLD-1')], bankRows: [], denominations: { '500': 1 }, invoiceImport: { id: 'x', fileName: 'old.xlsx' }, editLog: [], ...over });

test('rows are cleaned: only known fields, online rows start unverified, returns carry no payment split', () => {
  const result = cleanUploadRows([row('A', '2026-10-24T00:00:00Z', { extra: 1, paymentMode: 'UPI', cashAmount: 0, upiAmount: 100 })], '2026-10-24');
  assert.ok('rows' in result);
  assert.deepEqual(result.rows[0], { invoiceNumber: 'A', date: '2026-10-24', totalInvoiceAmount: 100, type: 'Invoice', paymentMode: 'UPI', cashAmount: 0, upiAmount: 100, cardAmount: 0, bankVerified: false });
  const returned = cleanUploadRows([{ invoiceNumber: 'R1', date: '2026-10-24', totalInvoiceAmount: 40, type: 'Return', paymentMode: 'RETURN', cashAmount: 5 }], '2026-10-24', 'return');
  assert.ok('rows' in returned);
  assert.equal(returned.rows[0].cashAmount, 0);
  assert.equal(returned.rows[0].bankVerified, true);
  assert.equal(returned.rows[0].paymentMode, 'RETURN');
});

test('rows are refused for another date, repeated numbers, bad amounts or modes', () => {
  assert.match((cleanUploadRows([row('A', '2026-10-23')], '2026-10-24') as any).error, /must be dated 2026-10-24/);
  assert.match((cleanUploadRows([row('A'), row('a ')], '2026-10-24') as any).error, /appears twice/);
  assert.ok('error' in cleanUploadRows([row('A', '2026-10-24', { totalInvoiceAmount: -1 })], '2026-10-24'));
  assert.ok('error' in cleanUploadRows([row('A', '2026-10-24', { paymentMode: 'CHEQUE' })], '2026-10-24'));
  assert.ok('error' in cleanUploadRows([], '2026-10-24'));
});

test('the sheet date creates a new B2C day with a server import stamp', () => {
  const r = ok(applyUpload({ batches: [day({ date: '2026-10-20' })] }, input([row('N1'), row('N2')]), billing, NOW));
  assert.equal(r.replaced, false);
  assert.equal(r.batchIndex, 1);
  const created = r.data.batches[1];
  assert.equal(created.date, '2026-10-24');
  assert.equal(created.status, 'Open');
  assert.equal(created.invoiceImport.fileName, 'day.xlsx');
  assert.equal(created.invoiceImport.importedAt, NOW);
  assert.equal(created.transactions.length, 2);
});

test('an uploaded day is not touched unless Replace is chosen; empty days can be filled', () => {
  const b2c = { batches: [day()] };
  assert.match((applyUpload(b2c, input([row('N1')]), billing, NOW) as any).error, /already has 1 invoices.*Replace/);
  const empty = { batches: [day({ transactions: [], invoiceImport: undefined })] };
  assert.equal(ok(applyUpload(empty, input([row('N1')]), billing, NOW)).replaced, false);
});

test('replace swaps the invoices, keeps bank rows and counts, resets submission and logs it', () => {
  const b2c = { batches: [day({ billingSubmitted: true, billingSubmittedBy: 'Bela', adminApproved: true, bankRows: [{ reference: 'R1' }] })] };
  const r = ok(applyUpload(b2c, input([row('N1'), row('N2')], { replace: true }), admin, NOW));
  const next = r.data.batches[0];
  assert.equal(r.replaced, true);
  assert.deepEqual(next.transactions.map((t: any) => t.invoiceNumber), ['N1', 'N2']);
  assert.equal(next.billingSubmitted, false);
  assert.equal(next.adminApproved, false);
  assert.equal(next.billingSubmittedBy, undefined);
  assert.deepEqual(next.bankRows, [{ reference: 'R1' }]);
  assert.deepEqual(next.denominations, { '500': 1 });
  assert.equal(next.id, 'd1');
  assert.equal(next.editLog.at(-1).action, 'replace');
  assert.match(next.editLog.at(-1).changes[0], /Replaced 1 invoices with 2 from day.xlsx/);
});

test('locked days cannot be replaced; billing cannot replace a submitted day', () => {
  assert.match((applyUpload({ batches: [day({ status: 'Submitted' })] }, input([row('N1')], { replace: true }), admin, NOW) as any).error, /locked/);
  const submitted = { batches: [day({ billingSubmitted: true })] };
  assert.equal((applyUpload(submitted, input([row('N1')], { replace: true }), billing, NOW) as any).status, 403);
  ok(applyUpload(submitted, input([row('N1')], { replace: true }), admin, NOW));
});

test('invoice numbers must stay unique across days, except the day being replaced', () => {
  const b2c = { batches: [day({ date: '2026-10-23', transactions: [row('X1', '2026-10-23')] }), day({ id: 'd2' })] };
  assert.match((applyUpload(b2c, input([row('x1')], { replace: true }), admin, NOW) as any).error, /x1.*2026-10-23/i);
  ok(applyUpload(b2c, input([row('OLD-1'), row('N2')], { replace: true }), admin, NOW));
});

test('deleting a day removes it, records the deletion and flags a locked day', () => {
  const b2c = { batches: [day(), day({ id: 'd2', date: '2026-10-25', status: 'Submitted', transactions: [row('Z1', '2026-10-25'), row('Z2', '2026-10-25')] })] };
  const r = removeB2cDay(b2c, '2026-10-25', { userId: 'a1', name: 'Arun' }, NOW);
  assert.ok('data' in r);
  assert.equal((r.data.batches as any[]).length, 1);
  assert.deepEqual((r.data.deletions as any[])[0], { at: NOW, userId: 'a1', name: 'Arun', date: '2026-10-25', invoices: 2, locked: true });
  assert.deepEqual(removeB2cDay(b2c, '2026-10-01', { userId: 'a1', name: 'Arun' }, NOW), { error: 'There is no B2C on that date.' });
  assert.deepEqual(removeB2cDay(b2c, 'x', { userId: 'a1', name: 'Arun' }, NOW), { error: 'Choose a valid date to delete.' });
});

const ret = (n: string, date = '2026-10-24', over: Record<string, unknown> = {}) =>
  ({ invoiceNumber: n, date, totalInvoiceAmount: 40, type: 'Return', paymentMode: 'RETURN', cashAmount: 0, upiAmount: 0, cardAmount: 0, bankVerified: true, ...over });
const returns = (rows: unknown[], over: Record<string, unknown> = {}) => input(rows, { kind: 'return', fileName: 'returns.xlsx', ...over });

test('a sales return file is the second upload of a day and keeps the invoices', () => {
  const b2c = { batches: [day()] };
  const r = ok(applyUpload(b2c, returns([ret('R1'), ret('R2')]), billing, NOW));
  const next = r.data.batches[0];
  assert.equal(r.replaced, false);
  assert.deepEqual(next.transactions.map((t: any) => t.invoiceNumber), ['OLD-1', 'R1', 'R2']);
  assert.equal(next.returnImport.fileName, 'returns.xlsx');
  assert.equal(next.invoiceImport.fileName, 'old.xlsx');
  assert.equal(next.editLog.at(-1).action, 'upload');
  assert.match(next.editLog.at(-1).changes[0], /Added 2 returns from returns.xlsx/);
});

test('returns can start a day, and invoices can be added after them', () => {
  const created = ok(applyUpload({ batches: [] }, returns([ret('R1')]), billing, NOW));
  assert.equal(created.data.batches[0].returnImport.fileName, 'returns.xlsx');
  assert.equal(created.data.batches[0].invoiceImport, undefined);
  const both = ok(applyUpload(created.data, input([row('N1')]), billing, NOW));
  assert.deepEqual(both.data.batches[0].transactions.map((t: any) => t.invoiceNumber), ['N1', 'R1']);
  assert.ok(both.data.batches[0].invoiceImport && both.data.batches[0].returnImport);
});

test('each kind can be uploaded once; Replace swaps only that kind', () => {
  const full = ok(applyUpload({ batches: [day()] }, returns([ret('R1')]), billing, NOW)).data;
  assert.match((applyUpload(full, returns([ret('R9')]), billing, NOW) as any).error, /already has 1 returns.*Replace/);
  const swappedReturns = ok(applyUpload(full, returns([ret('R9'), ret('R10')], { replace: true }), billing, NOW));
  assert.deepEqual(swappedReturns.data.batches[0].transactions.map((t: any) => t.invoiceNumber), ['OLD-1', 'R9', 'R10']);
  assert.equal(swappedReturns.replaced, true);
  const swappedInvoices = ok(applyUpload(full, input([row('N1'), row('N2')], { replace: true }), billing, NOW));
  assert.deepEqual(swappedInvoices.data.batches[0].transactions.map((t: any) => t.invoiceNumber), ['N1', 'N2', 'R1']);
});

test('a file must match the kind chosen, and numbers cannot repeat inside the day', () => {
  assert.match((applyUpload({ batches: [] }, returns([row('A1')]), billing, NOW) as any).error, /is an invoice, but this upload is for returns/);
  assert.match((applyUpload({ batches: [] }, input([ret('R1')]), billing, NOW) as any).error, /is a return, but this upload is for invoices/);
  assert.match((applyUpload({ batches: [day()] }, returns([ret('old-1')]), billing, NOW) as any).error, /already recorded in B2C for 2026-10-24/);
});

test('a legacy day whose invoice file also held returns needs Replace for returns', () => {
  const legacy = { batches: [day({ transactions: [row('OLD-1'), ret('OLD-R1')] })] };
  assert.match((applyUpload(legacy, returns([ret('R1')]), billing, NOW) as any).error, /already has 1 returns/);
});

test('submitted and locked days refuse the second file like any other change', () => {
  const submitted = { batches: [day({ billingSubmitted: true })] };
  assert.equal((applyUpload(submitted, returns([ret('R1')]), billing, NOW) as any).status, 403);
  const byAdmin = ok(applyUpload(submitted, returns([ret('R1')]), admin, NOW));
  assert.equal(byAdmin.data.batches[0].billingSubmitted, false);
  assert.match((applyUpload({ batches: [day({ status: 'Submitted' })] }, returns([ret('R1')]), admin, NOW) as any).error, /locked/);
});
