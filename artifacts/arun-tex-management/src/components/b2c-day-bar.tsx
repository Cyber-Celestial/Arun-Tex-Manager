import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'react-day-picker/style.css';
import './b2c-day-bar.css';

export type B2cDaySummary = { count: number; returns: number; stage: string };

const parseKey = (key: string) => new Date(`${key}T12:00:00`);
const keyOf = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const label = (key: string) => parseKey(key)
  .toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

/** Walks through every date: arrows jump between B2C days, the calendar opens any date up to today. */
export function B2cDayBar({ value, today, days, onSelect }: {
  value: string; today: string; days: Record<string, B2cDaySummary>; onSelect: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const withData = useMemo(() => Object.keys(days).sort(), [days]);
  const previous = [...withData].reverse().find(day => day < value);
  const next = withData.find(day => day > value);
  const summary = days[value];

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', dismiss); };
  }, [open]);

  return <div className="b2c-day-bar" ref={root}>
    <button type="button" className="b2c-day-arrow" disabled={!previous} onClick={() => previous && onSelect(previous)}
      aria-label="Previous B2C day" title={previous ? `Previous B2C day: ${label(previous)}` : 'No earlier B2C day'} data-testid="button-b2c-previous"><ChevronLeft size={16}/></button>
    <button type="button" className="b2c-day-trigger" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(v => !v)} data-testid="button-b2c-day">
      <strong>{label(value)}</strong>
      <small>{summary ? `${summary.count} invoices${summary.returns ? ` · ${summary.returns} returns` : ''} · ${summary.stage}` : 'No B2C yet'}</small>
    </button>
    <button type="button" className="b2c-day-arrow" disabled={!next} onClick={() => next && onSelect(next)}
      aria-label="Next B2C day" title={next ? `Next B2C day: ${label(next)}` : 'No later B2C day'} data-testid="button-b2c-next"><ChevronRight size={16}/></button>
    {open && <div className="b2c-day-calendar" role="dialog" aria-label="Choose a date">
      <DayPicker mode="single" selected={parseKey(value)} defaultMonth={parseKey(value)}
        disabled={{ after: parseKey(today) }} endMonth={parseKey(today)}
        modifiers={{ hasB2c: withData.map(parseKey) }} modifiersClassNames={{ hasB2c: 'b2c-has-data' }}
        onSelect={day => { if (day) { onSelect(keyOf(day)); setOpen(false); } }}/>
      <p className="b2c-day-legend"><i/> Dates with B2C are marked. Pick any date to see it or to upload for it.</p>
    </div>}
  </div>;
}
