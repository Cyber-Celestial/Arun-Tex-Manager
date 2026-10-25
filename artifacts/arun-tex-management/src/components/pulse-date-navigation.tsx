import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "./pulse-date-navigation.css";

export type PulseDateMode = "day" | "month";

export interface PulseDateNavigationProps {
  value: string;
  onChange: (value: string) => void;
  mode: PulseDateMode;
  onModeChange: (mode: PulseDateMode) => void;
  availableDates: string[];
  today: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
const dateAt = (y: number, m: number, d: number) => {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(y, m, d);
  return date;
};
const daysIn = (y: number, m: number) => dateAt(y, m + 1, 0).getDate();
const toIso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${pad(m + 1)}-${pad(d)}`;

function parse(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!match) return null;
  const y = Number(match[1]); const m = Number(match[2]) - 1; const d = Number(match[3]);
  if (y < 1 || y > 9999 || m < 0 || m > 11 || d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

function localToday() {
  const n = new Date();
  return toIso(n.getFullYear(), n.getMonth(), n.getDate());
}

function scrollIntoStrip(strip: HTMLElement | null, el: HTMLElement | null) {
  if (!strip || !el) return;
  const target = el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2;
  strip.scrollTo({ left: Math.max(0, target), behavior: "auto" });
}

export function PulseDateNavigation({ value, onChange, mode, onModeChange, availableDates, today }: PulseDateNavigationProps) {
  const todayParts = parse(today) ?? parse(localToday())!;
  const sel = parse(value) ?? todayParts;
  const { y, m, d } = sel;

  const available = useMemo(() => {
    const days = new Set<string>(); const months = new Set<string>(); const years = new Set<number>();
    for (const raw of availableDates) {
      const key = String(raw || "").slice(0, 10);
      const p = parse(key); if (!p) continue;
      days.add(key); months.add(key.slice(0, 7)); years.add(p.y);
    }
    return { days, months, years: Array.from(years).sort((a, b) => a - b) };
  }, [availableDates]);

  const monthStrip = useRef<HTMLDivElement>(null);
  const dayStrip = useRef<HTMLDivElement>(null);
  const monthRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dayRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { scrollIntoStrip(monthStrip.current, monthRefs.current[m]); }, [m, y]);
  useEffect(() => { if (mode === "day") scrollIntoStrip(dayStrip.current, dayRefs.current[d - 1]); }, [d, m, y, mode]);

  const go = (ny: number, nm: number, nd: number) => {
    if (ny < 1 || ny > 9999) return;
    onChange(toIso(ny, nm, Math.min(nd, daysIn(ny, nm))));
  };

  const count = daysIn(y, m);
  const days = Array.from({ length: count }, (_, i) => i + 1);
  const todayIso = toIso(todayParts.y, todayParts.m, todayParts.d);
  const selectedLabel = mode === "month"
    ? `${MONTHS_LONG[m]} ${y}, whole month`
    : dateAt(y, m, d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="pdn" data-testid="pulse-date-navigation">
      <div className="pdn-top">
        <div className="pdn-mode" role="group" aria-label="Period">
          {(["day", "month"] as const).map(k => (
            <button key={k} type="button" className={`pdn-mode-btn${mode === k ? " is-on" : ""}`} aria-pressed={mode === k} onClick={() => onModeChange(k)} data-testid={`button-mode-${k}`}>
              {k === "day" ? "Day" : "Month"}
            </button>
          ))}
        </div>
        <div className="pdn-year" role="group" aria-label="Year">
          <button type="button" className="pdn-icon" aria-label={`Previous year, ${y - 1}`} onClick={() => go(y - 1, m, d)} disabled={y <= 1} data-testid="button-prev-year"><ChevronLeft size={14} /></button>
          <span className="pdn-year-label mono" aria-live="polite" data-testid="text-selected-year">{y}</span>
          <button type="button" className="pdn-icon" aria-label={`Next year, ${y + 1}`} onClick={() => go(y + 1, m, d)} disabled={y >= 9999} data-testid="button-next-year"><ChevronRight size={14} /></button>
        </div>
        <input
          type="date"
          className="pdn-input mono"
          aria-label="Jump to date"
          value={toIso(y, m, d)}
          onChange={e => { const p = parse(e.target.value); if (p) go(p.y, p.m, p.d); }}
          data-testid="input-pulse-date"
        />
        <button type="button" className="pdn-today" onClick={() => { onModeChange("day"); onChange(todayIso); }} aria-label={`Reset to today, ${todayIso}`} data-testid="button-pulse-today">Today</button>
      </div>

      {available.years.length > 0 && (
        <div className="pdn-years" aria-label="Years with records">
          <span className="pdn-years-cap mono">RECORDS</span>
          {available.years.map(yr => (
            <button key={yr} type="button" className={`pdn-chip mono${yr === y ? " is-on" : ""}`} aria-pressed={yr === y} aria-label={`Go to year ${yr}`} onClick={() => go(yr, m, d)} data-testid={`button-year-${yr}`}>{yr}</button>
          ))}
        </div>
      )}

      <div className="pdn-strip" ref={monthStrip} role="group" aria-label={`Months of ${y}`}>
        {MONTHS.map((name, i) => {
          const has = available.months.has(`${y}-${pad(i + 1)}`);
          const on = i === m;
          return (
            <button key={name} ref={el => { monthRefs.current[i] = el; }} type="button"
              className={`pdn-cell pdn-month${on ? " is-on" : ""}${has ? " has-data" : ""}`}
              aria-pressed={on} aria-label={`${MONTHS_LONG[i]} ${y}${has ? ", has records" : ", no records"}`}
              onClick={() => go(y, i, d)} data-testid={`button-month-${i + 1}`}>
              <span>{name}</span><i aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {mode === "day" && (
        <div className="pdn-strip" ref={dayStrip} role="group" aria-label={`Days of ${MONTHS_LONG[m]} ${y}`}>
          {days.map(day => {
            const iso = toIso(y, m, day);
            const has = available.days.has(iso);
            const on = day === d;
            const wd = dateAt(y, m, day).getDay();
            return (
              <button key={iso} ref={el => { dayRefs.current[day - 1] = el; }} type="button"
                className={`pdn-cell pdn-day${on ? " is-on" : ""}${has ? " has-data" : ""}${iso === todayIso ? " is-today" : ""}`}
                aria-pressed={on}
                aria-label={`${dateAt(y, m, day).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${has ? ", has records" : ", no records"}${iso === todayIso ? ", today" : ""}`}
                onClick={() => go(y, m, day)} data-testid={`button-day-${day}`}>
                <small>{WEEKDAYS[wd]}</small><span className="mono">{day}</span><i aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}

      <div className="pdn-label" data-testid="text-selected-period">
        <span className="mono">{mode === "month" ? "MONTH TOTAL" : "SELECTED DAY"}</span>
        <strong>{selectedLabel}</strong>
        <em><i aria-hidden="true" /> has records</em>
      </div>
    </div>
  );
}

export default PulseDateNavigation;
