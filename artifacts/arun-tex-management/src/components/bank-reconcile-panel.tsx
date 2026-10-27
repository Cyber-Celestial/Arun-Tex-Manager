import { useState, type ButtonHTMLAttributes } from 'react';

type Row = Record<string, any>;

function Button({ kind = 'secondary', children, ...props }: { kind?: 'primary' | 'secondary' | 'quiet' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`btn btn-${kind}`} {...props}>{children}</button>;
}
export type ReconcileRequest =
  | { action: 'club'; paymentBatchId: string; invoiceNumber: string; mode: 'UPI' | 'CARD'; deposits: { batchId: string; rowIndex: number }[]; note: string }
  | { action: 'invoice-note'; paymentBatchId: string; invoiceNumber: string; mode: 'UPI' | 'CARD'; note: string }
  | { action: 'row-note'; depositBatchId: string; bankRowIndex: number; note: string };

type Props = {
  batch: Row;
  rows: Row[];
  role: string;
  busy: boolean;
  format: (value: unknown) => string;
  onReconcile: (request: ReconcileRequest) => Promise<boolean>;
};

type Draft =
  | { kind: 'club'; invoiceNumber: string; mode: 'UPI' | 'CARD'; expected: number; picked: number[]; note: string }
  | { kind: 'invoice-note'; invoiceNumber: string; mode: 'UPI' | 'CARD'; note: string }
  | { kind: 'row-note'; rowIndex: number; note: string };

const cents = (value: unknown) => Math.round((Number(value) || 0) * 100);
const dayOf = (value: unknown) => String(value ?? '').slice(0, 10);
const isAccounted = (row: Row) => Boolean(String(row.matchedInvoiceNumber ?? '').trim()) || Boolean(row.lateMatch) || Boolean(row.manualNote);

export function BankReconcilePanel({ batch, rows, role, busy, format, onReconcile }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const isAdmin = role === 'admin';
  const batchId = String(batch.id ?? '');
  const open = rows.filter(row => !isAccounted(row));
  const handled = (transaction: Row, mode: string) =>
    [transaction.bankMatches, transaction.lateBankMatches].some(list => Array.isArray(list) && list.some((match: Row) => match.mode === mode));
  const payments = (Array.isArray(batch.transactions) ? batch.transactions : []).flatMap((transaction: Row) =>
    transaction.type === 'Return' ? [] : (['UPI', 'CARD'] as const)
      .map(mode => ({ transaction, mode, expected: Number(mode === 'UPI' ? transaction.upiAmount : transaction.cardAmount) || 0 }))
      .filter(part => part.expected > 0 && !handled(part.transaction, part.mode)));

  if (!batchId || (!payments.length && !open.length)) return null;
  const locked = batch.status === 'Submitted';

  const submit = async () => {
    if (!draft) return;
    const note = draft.note.trim();
    const request: ReconcileRequest = draft.kind === 'club'
      ? { action: 'club', paymentBatchId: batchId, invoiceNumber: draft.invoiceNumber, mode: draft.mode, note,
          deposits: draft.picked.map(rowIndex => ({ batchId, rowIndex })) }
      : draft.kind === 'invoice-note'
        ? { action: 'invoice-note', paymentBatchId: batchId, invoiceNumber: draft.invoiceNumber, mode: draft.mode, note }
        : { action: 'row-note', depositBatchId: batchId, bankRowIndex: draft.rowIndex, note };
    if (await onReconcile(request)) setDraft(null);
  };

  const pickedTotal = draft?.kind === 'club'
    ? draft.picked.reduce((sum, index) => sum + cents(rows.find(row => row._sourceIndex === index)?.depositAmount), 0) : 0;
  const canSave = Boolean(draft?.note.trim()) && !busy &&
    (draft?.kind !== 'club' || (draft.picked.length >= 2 && pickedTotal === cents(draft.expected)));

  const form = draft && <div className="late-match-form reconcile-form">
    {draft.kind === 'club' && <div className="reconcile-picks">
      <strong>{draft.invoiceNumber} · {draft.mode} · {format(draft.expected)}</strong>
      {rows.filter(row => !isAccounted(row) && String(row.mode).toUpperCase() === draft.mode).map(row => <label key={row._sourceIndex} className="reconcile-pick">
        <input type="checkbox" checked={draft.picked.includes(row._sourceIndex)} data-testid={`check-club-row-${row._sourceIndex}`}
          onChange={event => setDraft({ ...draft, picked: event.target.checked ? [...draft.picked, row._sourceIndex] : draft.picked.filter(index => index !== row._sourceIndex) })}/>
        {dayOf(row.date)} · {format(row.depositAmount)} · {row.reference || 'No reference'}
      </label>)}
      <small className={pickedTotal === cents(draft.expected) ? 'reconcile-total reconcile-total-ok' : 'reconcile-total'}>Selected {format(pickedTotal / 100)} of {format(draft.expected)}</small>
    </div>}
    {draft.kind === 'invoice-note' && <strong>{draft.invoiceNumber} · {draft.mode}: accept without a bank deposit</strong>}
    {draft.kind === 'row-note' && <strong>Record this statement row as another inward</strong>}
    <label>Required note
      <textarea value={draft.note} maxLength={500} rows={2} data-testid="input-reconcile-note" placeholder="Why is this being reconciled manually?" onChange={event => setDraft({ ...draft, note: event.target.value })}/>
    </label>
    <div className="late-match-actions">
      <Button kind="primary" disabled={!canSave} onClick={() => void submit()} data-testid="button-save-reconcile">Save</Button>
      <Button disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
    </div>
  </div>;

  return <div className="reconcile-panel" data-testid="panel-reconcile">
    <div className="reconcile-heading"><strong>Still to account for</strong>
      <small>{payments.length} payment{payments.length === 1 ? '' : 's'} without a deposit · {open.length} statement row{open.length === 1 ? '' : 's'} unmatched. Every one needs a match or a note before the day locks.</small></div>
    {payments.map(({ transaction, mode, expected }) => <div className="reconcile-line" key={`${transaction.invoiceNumber}-${mode}`}>
      <span className="mono">{transaction.invoiceNumber}</span><span className="method-chip">{mode}</span><span className="mono">{format(expected)}</span>
      {!locked && <span className="reconcile-actions">
        <Button kind="quiet" disabled={busy} onClick={() => setDraft({ kind: 'club', invoiceNumber: transaction.invoiceNumber, mode, expected, picked: [], note: '' })} data-testid={`button-club-${transaction.invoiceNumber}-${mode}`}>Club deposits</Button>
        {isAdmin && <Button kind="quiet" disabled={busy} onClick={() => setDraft({ kind: 'invoice-note', invoiceNumber: transaction.invoiceNumber, mode, note: '' })} data-testid={`button-invoice-note-${transaction.invoiceNumber}-${mode}`}>Accept with note</Button>}
      </span>}
    </div>)}
    {open.map(row => <div className="reconcile-line" key={`row-${row._sourceIndex}`}>
      <span className="mono">{dayOf(row.date)}</span><span className="method-chip">{String(row.mode).toUpperCase()}</span><span className="mono">{format(row.depositAmount)}</span>
      <span className="reconcile-narration">{row.narration || row.reference || 'Bank deposit'}</span>
      {isAdmin && <span className="reconcile-actions"><Button kind="quiet" disabled={busy} onClick={() => setDraft({ kind: 'row-note', rowIndex: row._sourceIndex, note: '' })} data-testid={`button-row-note-${row._sourceIndex}`}>Add note</Button></span>}
    </div>)}
    {form}
  </div>;
}
