'use client';
import { useEffect, useRef, useState } from 'react';
import { IconDots } from '@/components/Icons';

/**
 * One handle per table row instead of a strip of icon buttons.
 *
 * Five buttons strung across a row pushed the table wider than the screen and
 * turned every row into a wall of icons. A single menu keeps the row narrow
 * and gives each action a readable NAME rather than a glyph to decipher.
 *
 * items: array of { label, icon, onClick, danger, disabled, title }.
 * Falsy entries are dropped, so callers can write `isAdmin && {...}` inline
 * without filtering first.
 */
export default function ActionMenu({ items = [], label = 'Actions' }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);   // flip above the button near the page bottom
  const boxRef = useRef(null);
  const btnRef = useRef(null);

  const actions = items.filter(Boolean);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Rows near the bottom of a long table would otherwise open a menu that
  // runs off the screen and cannot be reached.
  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setUp(window.innerHeight - r.bottom < 40 + actions.length * 38);
    }
    setOpen(!open);
  }

  if (!actions.length) return <span className="text-slate-300">—</span>;

  return (
    <div className="relative inline-block" ref={boxRef}>
      <button ref={btnRef} type="button" onClick={toggle} aria-label={label} aria-expanded={open}
              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition ${
                open ? 'border-brand-400 bg-brand-50 text-brand-700'
                     : 'border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-700'}`}>
        <IconDots size={16} />
      </button>

      {open && (
        <div className={`absolute right-0 z-40 min-w-[190px] rounded-xl border border-slate-200 bg-white shadow-lg py-1
                         ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {actions.map((a, i) => (
            <button key={i} type="button" title={a.title} disabled={a.disabled}
                    onClick={() => { setOpen(false); a.onClick?.(); }}
                    className={`w-full text-left px-3 py-2 text-[13px] font-semibold flex items-center gap-2.5 transition
                                disabled:opacity-40 disabled:cursor-not-allowed ${
                      a.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-600 hover:bg-slate-50'}`}>
              <span className={a.danger ? 'text-rose-500' : 'text-slate-400'}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
