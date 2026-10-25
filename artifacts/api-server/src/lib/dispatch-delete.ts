import { reconciliationDate } from './reconciliation-policy';

type RecordValue = Record<string, unknown>;
export type DeletionRecord = { at: string; userId: string; name: string; date: string; count: number; invoiceNumbers: string[] };

const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const MAX_LISTED_NUMBERS = 50;

/**
 * Removes every dispatch invoice dated on one business day and records who did it.
 * Deliberately does not re-validate the invoices that remain, so a day containing
 * legacy repeated invoice numbers can still be cleared.
 */
export function removeDispatchDay(dispatch: RecordValue, dayInput: unknown, actor: { userId: string; name: string }, now: string):
  { data: RecordValue; removed: number } | { error: string } {
  const day = reconciliationDate(dayInput);
  if (!day) return { error: 'Choose a valid date to delete.' };
  const invoices = Array.isArray(dispatch.invoices) ? dispatch.invoices : [];
  const removed = invoices.filter(invoice => object(invoice) && reconciliationDate(invoice.date) === day);
  if (!removed.length) return { error: 'There are no dispatch invoices on that date.' };
  const record: DeletionRecord = {
    at: now, userId: actor.userId, name: actor.name, date: day, count: removed.length,
    invoiceNumbers: removed.map(invoice => String((invoice as RecordValue).invoiceNumber ?? '')).slice(0, MAX_LISTED_NUMBERS),
  };
  const history = Array.isArray(dispatch.deletions) ? dispatch.deletions : [];
  return {
    removed: removed.length,
    data: { ...dispatch, invoices: invoices.filter(invoice => !removed.includes(invoice)), deletions: [...history, record] },
  };
}
