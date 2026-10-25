export type PulseTransaction = Record<string, unknown> & { date: string };
export type PulseMode = 'day' | 'month';

/** Business-date strings are dates, not UTC instants. */
export function localDateKey(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function businessDate(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return '';
  const [, year, month, day] = match;
  if (Number(year) < 1) return '';
  const parsed = new Date(0);
  parsed.setFullYear(Number(year), Number(month) - 1, Number(day));
  return localDateKey(parsed) === `${year}-${month}-${day}` ? `${year}-${month}-${day}` : '';
}

export function pulseTransactions(batches: Record<string, unknown>[]): PulseTransaction[] {
  return batches.flatMap(batch => Array.isArray(batch.transactions)
    ? batch.transactions.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
      .map(row => ({ ...row, date: businessDate(row.date || batch.date) }))
    : []);
}

const amount = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function summarizePulse(transactions: PulseTransaction[], selected: string, mode: PulseMode) {
  const valid = businessDate(selected);
  const rows = valid ? transactions.filter(row => row.date &&
    (mode === 'month' ? row.date.slice(0, 7) === valid.slice(0, 7) : row.date === valid)) : [];
  return {
    count: rows.length,
    sales: rows.filter(row => row.type !== 'Return').reduce((sum, row) => sum + amount(row.totalInvoiceAmount), 0),
    cash: rows.reduce((sum, row) => sum + amount(row.cashAmount), 0),
    upi: rows.reduce((sum, row) => sum + amount(row.upiAmount), 0),
    card: rows.reduce((sum, row) => sum + amount(row.cardAmount), 0),
  };
}
