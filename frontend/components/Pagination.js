'use client';
import { useEffect, useMemo, useState } from 'react';

export const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Client-side pagination hook.
 *   const { paged, controls } = usePagination(rows, [deps that reset to page 1]);
 *   render {paged} in the table, and <Pagination {...controls} /> below it.
 */
export function usePagination(rows, resetDeps = []) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Tolerate a momentary null/undefined (e.g. while a list is still loading,
  // or an API call resolved with no body) instead of crashing the page.
  const safeRows = rows || [];

  // Back to page 1 when filters/search change
  useEffect(() => { setPage(1); }, resetDeps); // eslint-disable-line react-hooks/exhaustive-deps

  const total = safeRows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);

  const paged = useMemo(
    () => safeRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [safeRows, safePage, pageSize]
  );

  return {
    paged,
    controls: { total, page: safePage, pages, pageSize, setPage, setPageSize },
  };
}

export default function Pagination({ total, page, pages, pageSize, setPage, setPageSize }) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  // Compact page numbers: first, current±1, last
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold">Rows:</span>
        <select
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600 outline-none focus:border-brand-500"
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>Showing <b>{start}–{end}</b> of <b>{total}</b></span>
      </div>

      <div className="flex items-center gap-1">
        <button className="btn-outline !px-3 !py-1.5 text-xs" disabled={page <= 1}
                onClick={() => setPage(page - 1)}>← Prev</button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} className="px-1.5 text-slate-400 text-xs">…</span>
          ) : (
            <button key={n} onClick={() => setPage(n)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition ${
                      n === page ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {n}
            </button>
          )
        )}
        <button className="btn-outline !px-3 !py-1.5 text-xs" disabled={page >= pages}
                onClick={() => setPage(page + 1)}>Next →</button>
      </div>
    </div>
  );
}
