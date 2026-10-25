import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { businessDate } from '@/lib/pulse-data';
import './overview-day-picker.css';

const parseKey = (key: string) => new Date(`${key}T12:00:00`);
const keyOf = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const fullLabel = (key: string) => parseKey(key)
  .toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();

export function OverviewDayPicker({ value, today, recordDates, onChange }: {
  value: string; today: string; recordDates: string[]; onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const withRecords = useMemo(
    () => recordDates.map(businessDate).filter(Boolean).map(parseKey), [recordDates]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return <span className="day-picker" ref={root}>
    <button type="button" className="day-picker-trigger" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(v => !v)} data-testid="button-day-picker">
      {fullLabel(value)} · DAY CLOSE<ChevronDown size={12} className={open ? 'day-picker-chevron-open' : ''}/>
    </button>
    {open && <div className="day-picker-calendar" role="dialog" aria-label="Choose a day">
      <DayPicker mode="single" selected={parseKey(value)} defaultMonth={parseKey(value)}
        disabled={{ after: parseKey(today) }} startMonth={new Date(2020, 0)} endMonth={parseKey(today)}
        modifiers={{ hasRecords: withRecords }} modifiersClassNames={{ hasRecords: 'day-has-records' }}
        onSelect={day => { if (day) { onChange(keyOf(day)); setOpen(false); } }}/>
    </div>}
  </span>;
}
