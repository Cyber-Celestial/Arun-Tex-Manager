import { useEffect, useState } from 'react';

/** Commit once on blur, not one workspace save per typed digit. */
export function ReconciliationNumberInput({ value, disabled, label, onCommit }: {
  value: number; disabled: boolean; label: string; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return <input className="cell-input mono" type="number" min="0" aria-label={label}
    value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)}
    onBlur={() => { const next = Number(draft); if (Number.isFinite(next) && next >= 0 && next !== value) onCommit(next); }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>;
}
