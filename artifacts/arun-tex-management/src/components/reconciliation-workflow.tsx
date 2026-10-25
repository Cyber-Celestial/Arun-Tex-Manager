import './reconciliation-workflow.css';
import { onlinePaymentCounts } from '@/lib/reconciliation';

type Batch = Record<string, any>;
type LogEntry = { at: string; name: string; role: string; action: string; changes?: string[] };

const actionLabel: Record<string, string> = {
  'billing-submit': 'Billing submitted the cash batch',
  'admin-approve': 'Admin approved the cash batch',
  'approval-cleared': 'Approval cleared by an edit',
  lock: 'Batch locked and Tally export unlocked',
  edit: 'Admin edited the batch',
};

export function WorkflowSteps({ batch }: { batch: Batch }) {
  const online = onlinePaymentCounts(Array.isArray(batch.transactions) ? batch.transactions : []);
  const locked = batch.status === 'Submitted';
  const steps = [
    { label: 'Cash submitted', done: Boolean(batch.billingSubmitted) || locked },
    { label: 'Admin approved', done: Boolean(batch.adminApproved) || locked },
    { label: online.total ? `Bank verified ${online.verified}/${online.total}` : 'No online payments', done: online.verified === online.total },
    { label: 'Locked', done: locked },
  ];
  return <ol className="workflow-steps" aria-label="Reconciliation progress">
    {steps.map(step => <li key={step.label} className={step.done ? 'workflow-step-done' : ''}><i/>{step.label}</li>)}
  </ol>;
}

export function ChangeLog({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) return null;
  return <details className="change-log">
    <summary>Change log ({entries.length})</summary>
    <ul>{[...entries].reverse().map((entry, i) => <li key={i}>
      <div><strong>{actionLabel[entry.action] ?? entry.action}</strong><span>{entry.name} · {entry.role}</span><time dateTime={entry.at}>{new Date(entry.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>
      {entry.changes?.length ? <ul className="change-log-changes">{entry.changes.map((change, j) => <li key={j}>{change}</li>)}</ul> : null}
    </li>)}</ul>
  </details>;
}
