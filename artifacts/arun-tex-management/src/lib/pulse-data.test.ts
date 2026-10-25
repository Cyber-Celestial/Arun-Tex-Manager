import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDate, localDateKey, pulseTransactions, summarizePulse } from './pulse-data';

const transactions = pulseTransactions([
  { date: '2024-02-28', transactions: [
    { date: '2024-02-28', totalInvoiceAmount: 100, cashAmount: 60, upiAmount: 40 },
    { date: '2024-02-29', totalInvoiceAmount: 200, cardAmount: 200 },
  ] },
  { date: '2024-02-29', transactions: [{ totalInvoiceAmount: 50, cashAmount: 50 }] },
  { date: '2024-03-01', transactions: [{ date: '2024-03-01', totalInvoiceAmount: 1000, upiAmount: 1000 }] },
]);

test('a selected day includes matching records across all batches', () => {
  assert.deepEqual(summarizePulse(transactions, '2024-02-29', 'day'),
    { count: 2, sales: 250, cash: 50, upi: 0, card: 200 });
});
test('a selected month includes leap day, not neighbouring months', () => {
  assert.deepEqual(summarizePulse(transactions, '2024-02-28', 'month'),
    { count: 3, sales: 350, cash: 110, upi: 40, card: 200 });
});
test('unavailable days and months return all zeros', () => {
  const zero = { count: 0, sales: 0, cash: 0, upi: 0, card: 0 };
  assert.deepEqual(summarizePulse(transactions, '2024-02-27', 'day'), zero);
  assert.deepEqual(summarizePulse(transactions, '2035-12-01', 'month'), zero);
  assert.deepEqual(summarizePulse([], '2024-02-29', 'day'), zero);
});
test('business dates do not shift across time zones and invalid dates are excluded', () => {
  assert.equal(businessDate('2024-02-29T00:00:00+05:30'), '2024-02-29');
  assert.equal(businessDate('2023-02-29'), '');
  assert.equal(businessDate('2024-13-01'), '');
  assert.equal(businessDate(null), '');
  const now = new Date(2026, 9, 25, 0, 15);
  assert.equal(localDateKey(now), '2026-10-25');
});
test('missing dates use batch date without changing the source; invalid amounts stay finite', () => {
  const batch = { date: '2024-02-29', transactions: [{ totalInvoiceAmount: 'not a number', cashAmount: Infinity }] };
  const rows = pulseTransactions([batch]);
  assert.equal(rows[0].date, '2024-02-29');
  assert.equal('date' in batch.transactions[0], false);
  assert.deepEqual(summarizePulse(rows, '2024-02-29', 'day'),
    { count: 1, sales: 0, cash: 0, upi: 0, card: 0 });
});
