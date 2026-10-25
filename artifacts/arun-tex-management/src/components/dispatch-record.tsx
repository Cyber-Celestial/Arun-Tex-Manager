import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './dispatch-record.css';

type RecordData = Record<string, any>;
function DispatchField({ label, value, disabled, onCommit }: {
  label: string; value: string; disabled: boolean; onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);
  return <label>{label}<input value={draft} disabled={disabled}
    onFocus={() => setFocused(true)} onChange={e => setDraft(e.target.value)}
    onBlur={() => { setFocused(false); if (draft !== value) onCommit(draft); }}/></label>;
}
export function DispatchRecord({ invoice, canEdit, busy, expanded, onToggle, onUpdate, onReview, children }: {
  invoice: RecordData; canEdit: boolean; busy: boolean; expanded: boolean; onToggle: () => void;
  onUpdate: (patch: RecordData) => void; onReview: () => void; children: ReactNode;
}) {
  const steps = [['eInvoiceDone','E-invoice'],['eWayDone','E-way bill'],['bundleDone','Bundle'],
    ['whatsappSent','WhatsApp'],['courierSent','Courier'],['vastraCourierUpdated','Vastra updated']];
  const original = invoice.invoicePdfObjectPath;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return <article className={`dispatch-card ${expanded ? 'dispatch-card-open' : ''}`}>
    <button type="button" className="dispatch-card-toggle" onClick={onToggle} aria-expanded={expanded}
      data-testid={`button-toggle-invoice-${invoice._idx}`}>
      <span className="dispatch-card-top"><span className="dispatch-card-main">
        <span className="mono invoice-ref">{invoice.invoiceNumber || 'B2B INVOICE'}</span>
        <strong>{invoice.customerName || 'Customer details pending'}</strong>
        <small>{invoice.date?.slice(0,10) || 'No date'} · {invoice.shipToDetails || invoice.billToDetails || 'Address not recorded'}</small>
      </span><span className="dispatch-card-side"><span className={`pill ${invoice.status === 'Completed' ? 'pill-good' : 'pill-warn'}`}>{invoice.status || 'Pending'}</span><ChevronDown size={16} className="dispatch-card-chevron"/></span></span>
    </button>
    <div className="checklist">{steps.map(([key,label]) => {
      const blocked = key === 'eWayDone' && invoice.ewayMovementBlocked;
      return <button key={key} type="button" className={`check-step ${invoice[key] ? 'checked' : ''}`}
        disabled={!canEdit || busy || blocked} title={blocked ? 'Replace the Part-A-only PDF before confirming movement.' : undefined}
        onClick={() => onUpdate({ [key]: !invoice[key] })} data-testid={`button-dispatch-${key}-${invoice._idx}`}>
        <span className="check-box">{invoice[key] && <Check size={12}/>}</span><span>{label}</span>
      </button>;
    })}<span className={`check-step ${invoice.lrNumber ? 'checked' : ''}`}><span className="check-box">{invoice.lrNumber && <Check size={12}/>}</span>LR number</span></div>
    {expanded && <div className="dispatch-card-details">
    <div className="invoice-record-actions">
      <button type="button" className="btn" onClick={onReview} disabled={!canEdit || busy}
        data-testid={`button-review-invoice-${invoice._idx}`}>Review details</button>
      {original && <a className="text-link" target="_blank" rel="noreferrer"
        href={`${base}/api/storage/objects${String(original).replace(/^\/objects/, '')}`}>Open original invoice PDF</a>}
      {invoice.totalInvoiceAmount != null && <span className="mono">{new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' }).format(invoice.totalInvoiceAmount)}</span>}
    </div>
    {invoice.ewayMovementBlocked && <div className="invoice-save-error" role="alert">
      <strong>Movement blocked. </strong>{invoice.ewayMovementWarning || 'Part B is missing.'} Upload a completed replacement PDF in Review details.
    </div>}
    {invoice.extractionWarnings?.length > 0 && <details className="invoice-record-warnings">
      <summary>Import review notes ({invoice.extractionWarnings.length})</summary>
      <ul>{invoice.extractionWarnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
    </details>}
    <div className="dispatch-fields">
      <DispatchField label="LR / tracking no." value={invoice.lrNumber || ''} disabled={!canEdit || busy} onCommit={lrNumber => onUpdate({lrNumber})}/>
      <DispatchField label="WhatsApp recipient" value={invoice.whatsappRecipient || ''} disabled={!canEdit || busy} onCommit={whatsappRecipient => onUpdate({whatsappRecipient})}/>
      <DispatchField label="E-way bill no." value={invoice.eWayBillNumber || ''} disabled={!canEdit || busy} onCommit={eWayBillNumber => onUpdate({eWayBillNumber})}/>
    </div>
    <div className="document-row">{children}</div>
    </div>}
  </article>;
}
