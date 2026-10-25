import test from 'node:test';
import assert from 'node:assert/strict';
import { removeDispatchDay } from './dispatch-delete';

const actor = { userId: 'a1', name: 'Arun' };
const inv = (invoiceNumber: string, date: string) => ({ invoiceNumber, date, status: 'Pending' });

test('removes only the invoices of the chosen day and records the deletion', () => {
  const dispatch = { invoices: [inv('A', '2026-10-22'), inv('B', '2026-10-22T00:00:00.000Z'), inv('C', '2026-10-23')] };
  const result = removeDispatchDay(dispatch, '2026-10-22', actor, 'NOW');
  assert.ok('data' in result);
  assert.equal(result.removed, 2);
  assert.deepEqual((result.data.invoices as any[]).map(i => i.invoiceNumber), ['C']);
  assert.deepEqual(result.data.deletions, [{ at: 'NOW', userId: 'a1', name: 'Arun', date: '2026-10-22', count: 2, invoiceNumbers: ['A', 'B'] }]);
  assert.equal(dispatch.invoices.length, 3);
});

test('a day with a repeated invoice number can still be cleared', () => {
  const result = removeDispatchDay({ invoices: [inv('INV-12', '2026-10-25'), inv('INV-12', '2026-10-25'), inv('X', '2026-10-24')] }, '2026-10-25', actor, 'NOW');
  assert.ok('data' in result);
  assert.equal(result.removed, 2);
  assert.deepEqual((result.data.invoices as any[]).map(i => i.invoiceNumber), ['X']);
});

test('keeps earlier deletion records and rejects bad or empty days', () => {
  const first = removeDispatchDay({ invoices: [inv('A', '2026-10-22'), inv('B', '2026-10-23')] }, '2026-10-22', actor, 'T1');
  assert.ok('data' in first);
  const second = removeDispatchDay(first.data, '2026-10-23', actor, 'T2');
  assert.ok('data' in second);
  assert.equal((second.data.deletions as any[]).length, 2);
  assert.deepEqual(removeDispatchDay({ invoices: [] }, '2026-10-22', actor, 'T'), { error: 'There are no dispatch invoices on that date.' });
  assert.deepEqual(removeDispatchDay({ invoices: [inv('A', '2026-10-22')] }, 'nope', actor, 'T'), { error: 'Choose a valid date to delete.' });
});
