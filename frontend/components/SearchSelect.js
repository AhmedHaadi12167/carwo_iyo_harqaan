'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Searchable dropdown for long lists.
 * options: [{ value, label, search }] — `search` is extra text to match (phone, code…)
 */
export default function SearchSelect({ options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));

  useEffect(() => {
    function onClick(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) =>
        o.label.toLowerCase().includes(q) || (o.search || '').toLowerCase().includes(q))
    : options;

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => { setOpen(!open); setQuery(''); }}
              className="input text-left flex items-center justify-between gap-2">
        <span className={selected ? '' : 'text-slate-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="text-slate-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full card shadow-xl p-1.5 max-h-72 overflow-y-auto">
          <input autoFocus className="input !py-2 mb-1.5" placeholder="Type to search…"
                 value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button"
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-50"
                  onClick={() => { onChange(''); setOpen(false); }}>
            — Clear selection —
          </button>
          {filtered.map((o) => (
            // An option can be marked `disabled` (e.g. a fabric that's out of
            // stock). It stays visible so the user can see it exists and why
            // it can't be picked, but it can't be selected.
            <button key={o.value} type="button" disabled={o.disabled}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                      o.disabled
                        ? 'text-slate-300 cursor-not-allowed'
                        : `hover:bg-brand-600/10 ${String(o.value) === String(value)
                            ? 'bg-brand-600/10 text-brand-700 font-bold' : 'text-slate-600'}`}`}
                    onClick={() => { if (!o.disabled) { onChange(o.value); setOpen(false); } }}>
              {o.label}
              {o.hint && <span className={`block text-[10.5px] ${o.disabled ? 'text-slate-300' : 'text-slate-400'}`}>{o.hint}</span>}
            </button>
          ))}
          {!filtered.length && <p className="px-3 py-3 text-sm text-slate-400">No matches.</p>}
        </div>
      )}
    </div>
  );
}
