'use client';
import { T } from '@/lib/labels';

/**
 * A date range with one-click shortcuts.
 *
 * Local date parts, never toISOString() — that converts to UTC and shifts the
 * day backwards for anyone east of Greenwich, which would file this morning's
 * orders under yesterday.
 */
const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoOf(new Date());

// Each shortcut returns [from, to] as local dates.
const SHORTCUTS = [
  { key: 'today', label: T.today, range: () => { const d = new Date(); return [isoOf(d), isoOf(d)]; } },
  { key: 'week', label: T.thisWeek, range: () => {
      const d = new Date();
      // Week starts Saturday in Somalia, not Monday.
      const back = (d.getDay() + 1) % 7;
      const s = new Date(d); s.setDate(d.getDate() - back);
      return [isoOf(s), isoOf(d)];
    } },
  { key: 'month', label: T.thisMonth, range: () => {
      const d = new Date();
      return [isoOf(new Date(d.getFullYear(), d.getMonth(), 1)), isoOf(d)];
    } },
];

export default function DateRangePicker({ from, to, onChange }) {
  function apply(fn) { const [f, t] = fn(); onChange({ from: f, to: t }); }

  // Which shortcut, if any, matches what is currently selected — so the
  // active one is highlighted instead of the user having to remember.
  const active = SHORTCUTS.find((s) => { const [f, t] = s.range(); return f === from && t === to; })?.key;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {SHORTCUTS.map((s) => (
          <button key={s.key} type="button" onClick={() => apply(s.range)}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition ${
                    active === s.key ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white'}`}>
            {s.label}
          </button>
        ))}
      </div>
      <input className="input !py-1.5 !px-2 !text-xs w-[140px]" type="date" value={from}
             max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} />
      <span className="text-xs text-slate-400">—</span>
      <input className="input !py-1.5 !px-2 !text-xs w-[140px]" type="date" value={to}
             min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} />
    </div>
  );
}
