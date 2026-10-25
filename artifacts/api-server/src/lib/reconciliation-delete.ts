import { reconciliationDate } from './reconciliation-policy';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Removes the B2C day(s) on one date and records who did it; a locked day may be removed by an Admin. */
export function removeB2cDay(b2c: RecordValue, dayInput: unknown, actor: { userId: string; name: string }, now: string):
  { data: RecordValue; invoices: number; locked: boolean } | { error: string } {
  const day = reconciliationDate(dayInput);
  if (!day) return { error: 'Choose a valid date to delete.' };
  const batches = Array.isArray(b2c.batches) ? b2c.batches : [];
  const removed = batches.filter(batch => object(batch) && reconciliationDate(batch.date) === day);
  if (!removed.length) return { error: 'There is no B2C on that date.' };
  const invoices = removed.reduce((sum, batch) => sum + (Array.isArray((batch as RecordValue).transactions) ? ((batch as RecordValue).transactions as unknown[]).length : 0), 0);
  const locked = removed.some(batch => (batch as RecordValue).status === 'Submitted');
  const history = Array.isArray(b2c.deletions) ? b2c.deletions : [];
  return {
    invoices, locked,
    data: { ...b2c, batches: batches.filter(batch => !removed.includes(batch)),
      deletions: [...history, { at: now, userId: actor.userId, name: actor.name, date: day, invoices, locked }] },
  };
}
