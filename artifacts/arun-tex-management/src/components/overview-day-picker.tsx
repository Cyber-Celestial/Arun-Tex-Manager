import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { businessDate, localDateKey } from '@/lib/pulse-data';
import './overview-day-picker.css';

const MIN_DAYS_BACK = 365;
const MAX_DAYS_BACK = 1825;

const parseKey = (key: string) => new Date(`${key}T12:00:00`);
const fullLabel = (key: string) => parseKey(key)
  .toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
const rowLabel = (key: string) => parseKey(key)
  .toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

function pastDayKeys(today: string, earliestRecord: string | undefined) {
  const todayDate = parseKey(today);
  const recordDays = earliestRecord
    ? Math.round((todayDate.getTime() - parseKey(earliestRecord).getTime()) / 86_400_000) : 0;
  const daysBack = Math.min(MAX_DAYS_BACK, Math.max(MIN_DAYS_BACK, recordDays));
  return Array.from({ length: daysBack + 1 }, (_, offset) => {
    const day = new Date(todayDate);
    day.setDate(todayDate.getDate() - offset);
    return localDateKey(day);
  });
}

export function OverviewDayPicker({ value, today, recordDates, onChange }: {
  value: string; today: string; recordDates: string[]; onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const selectedRow = useRef<HTMLButtonElement>(null);
  const withRecords = useMemo(() => new Set(recordDates.map(businessDate).filter(Boolean)), [recordDates]);
  const days = useMemo(() => pastDayKeys(today, [...withRecords].sort()[0]), [today, withRecords]);

  useEffect(() => {
    if (!open) return;
    selectedRow.current?.scrollIntoView({ block: 'center' });
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return <span className="day-picker" ref={root}>
    <button type="button" className="day-picker-trigger" aria-haspopup="listbox" aria-expanded={open}
      onClick={() => setOpen(v => !v)} data-testid="button-day-picker">
      {fullLabel(value)} · DAY CLOSE<ChevronDown size={12} className={open ? 'day-picker-chevron-open' : ''}/>
    </button>
    {open && <div className="day-picker-list" role="listbox" aria-label="Choose a day">
      {days.map(key => <button key={key} type="button" role="option" aria-selected={key === value}
        ref={key === value ? selectedRow : undefined}
        className={`day-picker-row ${key === value ? 'day-picker-row-selected' : ''}`}
        onClick={() => { onChange(key); setOpen(false); }} data-testid={`option-day-${key}`}>
        <span>{rowLabel(key)}</span>
        <span className="day-picker-tags">{key === today && <em>Today</em>}{withRecords.has(key) && <i title="Has records"/>}</span>
      </button>)}
    </div>}
  </span>;
}
