import test from 'node:test';
import assert from 'node:assert/strict';
import { dateCell, parseVastraSheets } from './vastra-import';

const invoiceSheet = [
  { 'Invoice Number': 'INV-1', 'Invoice Date': '24/10/2026', 'Agent Name': 'CASH', 'Invoice Net Amount': 500 },
  { 'Invoice Number': 'INV-1', 'Invoice Date': '24/10/2026', 'Agent Name': 'CASH', 'Invoice Net Amount': 500 },
  { 'Invoice Number': 'INV-2', 'Invoice Date': '24/10/2026', 'Agent Name': 'Upi', 'Invoice Net Amount': '₹1,200.50' },
  { 'Invoice Number': 'INV-3', 'Invoice Date': '24/10/2026', 'Agent Name': 'SPLIT', 'Invoice Net Amount': 900, 'Cash Amount': 400, 'UPI Amount': 500 },
  { 'Invoice Number': '', 'Invoice Date': '24/10/2026', 'Agent Name': 'CASH', 'Invoice Net Amount': 10 },
];
const returnSheet = [
  { 'Order Return Number': 'RET-1', 'Date': '24/10/2026', 'Net Amount': -150, 'Quantity': 1 },
  { 'Order Return Number': 'RET-1', 'Date': '24/10/2026', 'Net Amount': -150, 'Quantity': 2 },
  { 'Order Return Number': 'RET-2', 'Date': '2026-10-24', 'Net Amount': '₹75', 'Quantity': 1 },
  { 'Order Return Number': 'RET-3', 'Date': '24/10/2026', 'Net Amount': 0 },
];

test('invoice files read the invoice columns, payment mode and split amounts', () => {
  const result = parseVastraSheets([{ name: 'Sheet1', rows: invoiceSheet }], 'invoice');
  assert.ok('rows' in result);
  assert.deepEqual(result.rows.map(r => [r.invoiceNumber, r.date, r.totalInvoiceAmount, r.paymentMode, r.cashAmount, r.upiAmount]),
    [['INV-1', '2026-10-24', 500, 'CASH', 500, 0], ['INV-1', '2026-10-24', 500, 'CASH', 500, 0],
     ['INV-2', '2026-10-24', 1200.5, 'UPI', 0, 1200.5], ['INV-3', '2026-10-24', 900, 'SPLIT', 400, 500]]);
  assert.equal(result.rows[2].bankVerified, false);
  assert.equal(result.rows[0].type, 'Invoice');
});

test('return files read the return columns and become negative-free Return rows', () => {
  const result = parseVastraSheets([{ name: 'Sales Return', rows: returnSheet }], 'return');
  assert.ok('rows' in result);
  assert.deepEqual(result.rows.map(r => [r.invoiceNumber, r.date, r.totalInvoiceAmount, r.type, r.paymentMode, r.cashAmount]),
    [['RET-1', '2026-10-24', 150, 'Return', 'RETURN', 0], ['RET-1', '2026-10-24', 150, 'Return', 'RETURN', 0], ['RET-2', '2026-10-24', 75, 'Return', 'RETURN', 0]]);
  assert.equal(result.rows[0].bankVerified, true);
});

test('choosing the wrong kind is caught from the columns', () => {
  const asReturn = parseVastraSheets([{ name: 'S', rows: invoiceSheet }], 'return');
  assert.ok('error' in asReturn);
  assert.match(asReturn.error, /no "Order Return Number" column.*choose Sales invoices/);
  const asInvoice = parseVastraSheets([{ name: 'S', rows: returnSheet }], 'invoice');
  assert.ok('error' in asInvoice);
  assert.match(asInvoice.error, /no "Invoice Number" column.*choose Sales returns/);
  assert.match((parseVastraSheets([], 'invoice') as any).error, /no "Invoice Number" column/);
});

test('dates accept Indian day-first text, ISO text, real dates and Excel serial numbers', () => {
  assert.equal(dateCell('24/10/2026'), '2026-10-24');
  assert.equal(dateCell('4-1-26'), '2026-01-04');
  assert.equal(dateCell('2026-10-24T00:00:00.000Z'), '2026-10-24');
  assert.equal(dateCell(new Date(2026, 9, 24, 12)), '2026-10-24');
  assert.equal(dateCell(46319), '2026-10-24');
  assert.equal(dateCell('not a date'), '');
});
