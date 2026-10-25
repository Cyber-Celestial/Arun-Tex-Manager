import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { Trash2 } from 'lucide-react';
import 'react-day-picker/style.css';
import './delete-day-control.css';

const parseKey = (key: string) => new Date(`${key}T12:00:00`);
const keyOf = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const longLabel = (key: string) => parseKey(key)
  .toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

/** Delete button that opens a calendar of the days holding data, then asks for confirmation. */
export function DeleteDayControl({ label, noun, counts, disabled = false, warning, onDelete }: {
  label: string;
  noun: string;
  counts: Record<string, number>;
  disabled?: boolean;
  warning?: (day: string) => string | null;
  onDelete: (day: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLSpanElement>(null);
  const days = useMemo(() => Object.keys(counts).filter(day => counts[day] > 0).sort(), [counts]);
  const latest = days.at(-1);

  const close = () => { setOpen(false); setPicked(null); setError(''); };
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', dismiss); };
  }, [open]);

  const confirm = async () => {
    if (!picked || busy) return;
    setBusy(true); setError('');
    try { await onDelete(picked); close(); }
    catch (e: any) { setError(e?.data?.error || e?.message || 'Delete failed. Nothing was removed.'); }
    finally { setBusy(false); }
  };

  const extraWarning = picked ? warning?.(picked) : null;
  return <span className="delete-day" ref={root}>
    <button type="button" className="btn btn-secondary delete-day-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => (open ? close() : setOpen(true))} data-testid="button-delete-day"><Trash2 size={14}/> {label}</button>
    {open && <div className="delete-day-popover" role="dialog" aria-label={label}>
      {days.length === 0 ? <p className="delete-day-empty">Nothing to delete yet.</p> : <>
        <p className="delete-day-hint">Choose the date to delete. Dates with {noun} are marked.</p>
        <DayPicker mode="single" selected={picked ? parseKey(picked) : undefined} defaultMonth={latest ? parseKey(latest) : undefined}
          disabled={day => !counts[keyOf(day)]} startMonth={parseKey(days[0])} endMonth={parseKey(latest!)}
          modifiers={{ hasData: days.map(parseKey) }} modifiersClassNames={{ hasData: 'delete-day-has-data' }}
          onSelect={day => { setError(''); setPicked(day ? keyOf(day) : null); }}/>
      </>}
      {picked && <div className="delete-day-confirm" role="alertdialog" aria-label="Confirm delete">
        <strong>Delete {counts[picked]} {noun} dated {longLabel(picked)}?</strong>
        <span>This cannot be undone.</span>
        {extraWarning && <span className="delete-day-warning">{extraWarning}</span>}
        {error && <span className="delete-day-error" role="alert">{error}</span>}
        <div>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirm()} data-testid="button-confirm-delete-day">{busy ? 'Deleting…' : 'Delete'}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
        </div>
      </div>}
    </div>}
  </span>;
}
