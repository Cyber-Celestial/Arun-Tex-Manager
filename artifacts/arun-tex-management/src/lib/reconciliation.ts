import { businessDate } from './pulse-data';

export function reconciliationUploaded(batch: Record<string, any>): boolean {
  return (Array.isArray(batch.transactions) && batch.transactions.length > 0) ||
    Boolean(batch.invoiceImport && typeof batch.invoiceImport === 'object');
}

export function reconciliationLabel(value: unknown): string {
  const day = businessDate(value);
  return day ? new Date(`${day}T12:00:00`).toLocaleDateString('en-IN',
    { day: '2-digit', month: 'short', year: 'numeric' }) : String(value || 'Undated legacy batch');
}

export function emptyReconciliation(date: string) {
  return { id: crypto.randomUUID(), date, status: 'Open', transactions: [], bankRows: [],
    denominations: { '500': 0, '200': 0, '100': 0, '50': 0, '20': 0, '10': 0, '5': 0, '2': 0, '1': 0 } };
}

export type BatchStage = { label: string; tone: 'neutral' | 'warn' | 'good' };

/** Where a reconciliation stands in the Billing submit → Admin approval → lock flow. */
export function batchStage(batch: Record<string, any>): BatchStage {
  if (batch.status === 'Submitted') return { label: 'Locked', tone: 'good' };
  if (batch.adminApproved) return { label: 'Approved · awaiting bank', tone: 'warn' };
  if (batch.billingSubmitted) return { label: 'Cash submitted', tone: 'warn' };
  return { label: 'Open', tone: 'neutral' };
}

export function onlinePaymentCounts(transactions: Record<string, any>[]) {
  const online = transactions.filter(row => row.type !== 'Return' && (Number(row.upiAmount) > 0 || Number(row.cardAmount) > 0));
  return { verified: online.filter(row => row.bankVerified === true).length, total: online.length };
}
