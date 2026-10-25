import { useEffect, useMemo, useRef, useState } from 'react';
import { useRequestUploadUrl } from '@workspace/api-client-react';
import { readInvoicePdf } from '@/lib/read-invoice-pdf';
import { emptyInvoice, fromDispatchInvoice, invoiceErrors, toDispatchInvoice, type InvoiceMetadata, type Party } from '@/lib/invoice-model';
import './dispatch-invoice-form.css';

type Props = { initial?: Record<string, any>; onSave: (record: Record<string, any>) => Promise<unknown>; onCancel: () => void };
type TopKey = Exclude<keyof InvoiceMetadata, 'bill_to' | 'ship_to'>;
type Timing = { pdfMs: number; parseMs: number; pages: number };

const TOP: { key: TopKey; label: string; mono?: boolean; wide?: boolean; type?: string }[] = [
  { key: 'invoice_number', label: 'Invoice number', mono: true },
  { key: 'invoice_date', label: 'Invoice date', type: 'date' },
  { key: 'total', label: 'Invoice total (INR)', mono: true },
  { key: 'customer_name', label: 'Customer name', wide: true },
  { key: 'customer_gst_number', label: 'Customer GSTIN', mono: true },
  { key: 'irn_number', label: 'IRN (64 hex)', mono: true, wide: true },
  { key: 'ack_number', label: 'Ack number', mono: true },
  { key: 'eway_bill_number', label: 'E-Way Bill number', mono: true },
  { key: 'transporter', label: 'Transporter' },
  { key: 'lr_number', label: 'LR number', mono: true },
  { key: 'courier_number', label: 'Courier / docket', mono: true },
  { key: 'delivery_challan', label: 'Delivery challan', mono: true },
  { key: 'bale_reference', label: 'Bale reference', mono: true },
];
const PARTY: { key: keyof Party; label: string; mono?: boolean; wide?: boolean }[] = [
  { key: 'name', label: 'Name', wide: true }, { key: 'address', label: 'Address', wide: true },
  { key: 'city', label: 'City' }, { key: 'state', label: 'State' },
  { key: 'state_code', label: 'State code', mono: true }, { key: 'pincode', label: 'Pincode', mono: true },
  { key: 'phone', label: 'Phone', mono: true }, { key: 'gstin', label: 'GSTIN', mono: true },
];

const objectUrl = (path: string) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/storage/objects${path.replace(/^\/objects/, '')}`;

export function DispatchInvoiceForm({ initial, onSave, onCancel }: Props) {
  const meta = initial ?? {};
  const [fields, setFields] = useState<InvoiceMetadata>(() => fromDispatchInvoice(initial));
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const touchedRef = useRef(touched); touchedRef.current = touched;
  const [file, setFile] = useState<File | null>(null);
  const [objectPath, setObjectPath] = useState<string | null>(meta.invoicePdfObjectPath ?? null);
  const [pdfName, setPdfName] = useState<string | null>(meta.invoicePdfName ?? null);
  const [warnings, setWarnings] = useState<string[]>(meta.extractionWarnings ?? []);
  const [sources, setSources] = useState<Record<string, string>>(meta.extractionSources ?? {});
  const [blocked, setBlocked] = useState<boolean>(!!meta.ewayMovementBlocked);
  const [blockMsg, setBlockMsg] = useState<string | null>(meta.ewayMovementWarning ?? null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [reading, setReading] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [progress, setProgress] = useState('');
  const [readError, setReadError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const savingRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestUpload = useRequestUploadUrl();
  const uploadRef = useRef(requestUpload.mutateAsync); uploadRef.current = requestUpload.mutateAsync;

  useEffect(() => () => abortRef.current?.abort(), []);
  const errors = useMemo(() => invoiceErrors(fields), [fields]);

  const markEdited = (path: string) => { setTouched((t) => new Set(t).add(path)); setConfirmed(false); };
  const setTop = (key: TopKey, raw: string) => {
    const v = raw === '' ? null : key === 'total' ? Number(raw.replace(/,/g, '')) : raw;
    setFields((f) => ({ ...f, [key]: key === 'customer_gst_number' && typeof v === 'string' ? v.toUpperCase() : v }));
    markEdited(key);
  };
  const setParty = (side: 'bill_to' | 'ship_to', key: keyof Party, raw: string) => {
    const v = raw === '' ? null : key === 'gstin' ? raw.toUpperCase() : raw;
    setFields((f) => ({ ...f, [side]: { ...f[side], [key]: v } }));
    markEdited(`${side}.${key}`);
  };

  async function runRead(target: File) {
    abortRef.current?.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const gen = ++genRef.current;
    setReading(true); setPdfReady(false); setReadError(null); setProgress('Opening PDF locally'); setConfirmed(false);
    try {
      const res = await readInvoicePdf(target, (m) => { if (gen === genRef.current) setProgress(m); }, ctrl.signal);
      if (gen !== genRef.current || ctrl.signal.aborted) return;
      const t = touchedRef.current;
      setFields((cur) => {
        const next: InvoiceMetadata = { ...cur, bill_to: { ...cur.bill_to }, ship_to: { ...cur.ship_to } };
        for (const { key } of TOP) if (!t.has(key) && res.fields[key] !== null) (next as any)[key] = res.fields[key];
        for (const side of ['bill_to', 'ship_to'] as const)
          for (const { key } of PARTY) if (!t.has(`${side}.${key}`) && res.fields[side][key] !== null) next[side][key] = res.fields[side][key];
        return next;
      });
      setWarnings(res.warnings); setSources(res.sources); setBlocked(res.movementBlocked);
      setBlockMsg(res.movementWarning); setTiming(res.timing);
      setPdfReady(true);
    } catch (e: any) {
      if (gen !== genRef.current || ctrl.signal.aborted) return;
      setReadError(e?.message || 'The PDF could not be read.');
    } finally {
      if (gen === genRef.current) { setReading(false); setProgress(''); }
    }
  }

  function choose(f: File | undefined) {
    if (!f) return;
    setFile(f); setPdfName(f.name); setObjectPath(null);
    void runRead(f);
  }
  function cancelRead() { abortRef.current?.abort(); genRef.current++; setReading(false); setProgress(''); setConfirmed(false); }
  function removeSelected() {
    cancelRead(); setFile(null); setPdfReady(false); setReadError(null);
    setObjectPath(meta.invoicePdfObjectPath ?? null); setPdfName(meta.invoicePdfName ?? null);
    setBlocked(!!meta.ewayMovementBlocked); setBlockMsg(meta.ewayMovementWarning ?? null);
    setWarnings(meta.extractionWarnings ?? []); setSources(meta.extractionSources ?? {}); setTiming(null);
    if (fileInput.current) fileInput.current.value = '';
  }
  function resetAll() {
    cancelRead();
    setFields(emptyInvoice()); setTouched(new Set()); setFile(null); setPdfName(null); setObjectPath(null);
    setWarnings([]); setSources({}); setBlocked(!!meta.ewayMovementBlocked); setBlockMsg(meta.ewayMovementWarning ?? null); setTiming(null); setPdfReady(false);
    if (initial) { setObjectPath(meta.invoicePdfObjectPath ?? null); setPdfName(meta.invoicePdfName ?? null); }
    setReadError(null); setConfirmed(false); setShowErrors(false); setSaveError(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit() {
    if (savingRef.current || reading || (file && !pdfReady)) return;
    setShowErrors(true);
    if (errors.length || !confirmed) return;
    savingRef.current = true; setSaving(true); setSaveError(null);
    try {
      let path = objectPath;
      if (file && !path) {
        const { uploadURL, objectPath: op } = await uploadRef.current({ data: { name: file.name, size: file.size, contentType: 'application/pdf' } });
        const put = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
        if (!put.ok) throw new Error(`PDF upload failed (${put.status}).`);
        path = op; setObjectPath(op);
      }
      const record: Record<string, any> = {
        ...meta, ...toDispatchInvoice(fields),
        invoicePdfObjectPath: path, invoicePdfName: pdfName,
        extractionWarnings: warnings, extractionSources: sources,
        ewayMovementBlocked: blocked, ewayMovementWarning: blockMsg,
      };
      // A replacement or changed identifier needs a new explicit compliance
      // check; do not inherit a completed check from the previous document.
      if (file || fields.irn_number !== (meta.eInvoiceIrn || null)) record.eInvoiceDone = false;
      if (file || fields.eway_bill_number !== (meta.eWayBillNumber || null)) record.eWayDone = false;
      if (blocked) { record.eWayDone = false; record.status = 'Pending'; }
      await onSave(record);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed. Your draft is kept; try again.');
    } finally { savingRef.current = false; setSaving(false); }
  }

  const tag = (path: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return <span className="dif-tag dif-tag-missing">Missing</span>;
    if (touched.has(path)) return <span className="dif-tag dif-tag-manual">Manual</span>;
    if (sources[path]) return <span className="dif-tag dif-tag-pdf">PDF</span>;
    return null;
  };
  const field = (path: string, label: string, value: string, onChange: (v: string) => void, o: { mono?: boolean; wide?: boolean; type?: string; area?: boolean }) => {
    const id = `dif-${path.replace('.', '-')}`;
    return (
      <div key={path} className={`dif-field${o.wide ? ' dif-wide' : ''}${o.mono ? ' mono-in' : ''}${value ? '' : ' missing'}`}>
        <label htmlFor={id}>{label} {tag(path, value)}</label>
        {o.area
          ? <textarea id={id} data-testid={`input-${id}`} value={value} onChange={(e) => onChange(e.target.value)} disabled={saving} />
          : <input id={id} data-testid={`input-${id}`} type={o.type ?? 'text'} inputMode={path === 'total' ? 'decimal' : undefined} value={value} onChange={(e) => onChange(e.target.value)} disabled={saving} />}
        {sources[path] && <span className="dif-src" title={sources[path]}>from: {sources[path]}</span>}
      </div>
    );
  };

  const party = (side: 'bill_to' | 'ship_to', title: string) => (
    <section className="dif-section" aria-label={title}>
      <header><h3>{title}</h3><span>{side === 'bill_to' ? 'BILLED PARTY' : 'CONSIGNEE'}</span></header>
      <div className="dif-grid">
        {PARTY.map((p) => field(`${side}.${p.key}`, p.label, fields[side][p.key] ?? '', (v) => setParty(side, p.key, v), { mono: p.mono, wide: p.wide, area: p.key === 'address' }))}
      </div>
    </section>
  );

  return (
    <form className="dif" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate data-testid="form-dispatch-invoice">
      <div className="dif-head">
        <div>
          <span className="eyebrow">{initial ? 'REVIEW B2B INVOICE' : 'ADD B2B INVOICE'}</span>
          <h2>Invoice details</h2>
          <p>Choose the GST invoice PDF to prefill fields. It is read in this browser from its text layer; scanned or image-only PDFs will need manual entry. The original is stored only when you save.</p>
        </div>
        {objectPath && !file && <a className="dif-link" href={objectUrl(objectPath)} target="_blank" rel="noreferrer" data-testid="link-original-pdf">Open original PDF{pdfName ? `: ${pdfName}` : ''}</a>}
      </div>

      <div className="dif-intake">
        <label className="dif-drop">
          <input ref={fileInput} type="file" accept="application/pdf,.pdf" data-testid="input-invoice-pdf" disabled={saving}
            onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
          {pdfName ? 'Replace invoice PDF' : 'Choose invoice PDF'}
        </label>
        <div className="dif-file">
          <strong data-testid="text-pdf-name">{pdfName ?? 'No PDF selected'}</strong>
          {reading ? <span className="dif-progress" role="status"><i />{progress || 'Reading'}</span>
            : <span>{file ? (objectPath ? 'Uploaded, will be attached on save' : 'Read locally, uploads on save') : objectPath ? 'Stored original on file' : 'Manual entry is always available'}</span>}
        </div>
        <div className="dif-intake-actions">
          {reading && <button type="button" className="btn" onClick={cancelRead} data-testid="button-cancel-read">Cancel reading</button>}
          {!reading && file && <button type="button" className="btn" onClick={() => runRead(file)} disabled={saving} data-testid="button-reread">Read again</button>}
          {file && <button type="button" className="btn" onClick={removeSelected} disabled={saving}>Remove selected PDF, keep fields</button>}
          <button type="button" className="btn btn-quiet" onClick={resetAll} disabled={saving} data-testid="button-reset">Reset all fields</button>
        </div>
      </div>

      {blocked && (
        <div className="dif-alert dif-alert-block" role="alert" data-testid="alert-movement-blocked">
          <div><strong>Goods movement not permitted yet</strong>{blockMsg || 'E-Way Bill Part B (vehicle details) is not filled. This entry will be saved as Pending with E-Way not done.'}</div>
        </div>
      )}
      {readError && (
        <div className="dif-alert dif-alert-error" role="alert">
          <div><strong>PDF could not be read</strong>{readError} You can retry, reset, or enter the details by hand.</div>
          {file && <button type="button" className="btn" disabled={saving||reading} onClick={() => runRead(file)}>Retry</button>}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="dif-alert dif-alert-warn" data-testid="list-extraction-warnings">
          <div><strong>Check before saving</strong><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
        </div>
      )}
      {timing && (
        <div className="dif-meta" data-testid="text-parse-timing">
          <span>pages <b>{timing.pages}</b></span><span>pdf text <b>{Math.round(timing.pdfMs)} ms</b></span>
          <span>parse <b>{Math.round(timing.parseMs)} ms</b></span><span>fields sourced <b>{Object.keys(sources).length}</b></span>
          {touched.size > 0 && <span>manual edits kept <b>{touched.size}</b></span>}
        </div>
      )}

      <section className="dif-section" aria-label="Invoice and transport">
        <header><h3>Invoice and transport</h3><span>GST / E-INVOICE</span></header>
        <div className="dif-grid">
          {TOP.map((t) => field(t.key, t.label, fields[t.key] === null ? '' : String(fields[t.key]), (v) => setTop(t.key, v), t))}
        </div>
      </section>

      <div className="dif-parties">{party('bill_to', 'Bill to')}{party('ship_to', 'Ship to')}</div>

      {showErrors && errors.length > 0 && (
        <div className="dif-alert dif-alert-error" role="alert" data-testid="list-validation-errors">
          <div><strong>Fix before saving</strong><ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
        </div>
      )}
      {saveError && (
        <div className="dif-alert dif-alert-error" role="alert" data-testid="text-save-error">
          <div><strong>Not saved</strong>{saveError}</div>
        </div>
      )}

      <div className="dif-foot">
        <label className="dif-confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={saving || reading} data-testid="checkbox-confirm-review" />
          <span>I have checked these details against the invoice{blocked ? ' and understand movement is blocked until Part B is filled' : ''}.</span>
        </label>
        <div className="dif-foot-actions">
          <button type="button" className="btn" onClick={() => { cancelRead(); onCancel(); }} disabled={saving} data-testid="button-cancel">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || reading || !confirmed || (!!file && !pdfReady)} data-testid="button-save-invoice">
            {saving ? (file && !objectPath ? 'Uploading PDF' : 'Saving') : 'Save invoice'}
          </button>
        </div>
      </div>
    </form>
  );
}

export default DispatchInvoiceForm;
