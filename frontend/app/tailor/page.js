'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate } from '@/lib/api';
import { StatusBadge } from '@/components/Badges';
import { IconCalendar } from '@/components/Icons';
import { T } from '@/lib/labels';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'in_progress', label: T.inProgress },
  { value: 'completed', label: T.completed },
  { value: 'delivered', label: T.delivered },
];

export default function MyJobs() {
  const [jobs, setJobs] = useState(null);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    Promise.all([
      api(`/tailor/my${filter ? `?status=${filter}` : ''}`),
      api('/tailor/stats'),
    ]).then(([j, s]) => { setJobs(j); setStats(s); })
      .catch((e) => setError(e.message));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(job, status) {
    setBusy(job.id);
    setError('');
    try {
      await api(`/tailor/my/${job.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (e) { setError(e.message); }
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800">My Jobs</h1>
          <p className="text-xs text-slate-400">Orders the shop assigned to you</p>
        </div>
        <button onClick={load} className="btn-outline !px-3 !py-2 text-xs">↻ Refresh</button>
      </div>

      {/* My performance */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <div className="card p-3 text-center">
            <p className="text-2xl font-extrabold text-slate-800">{stats.total}</p>
            <p className="text-[10px] font-bold uppercase text-slate-400">Total</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-2xl font-extrabold text-blue-500">{stats.in_progress}</p>
            <p className="text-[10px] font-bold uppercase text-slate-400">{T.inProgress}</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-2xl font-extrabold text-emerald-500">{stats.completed}</p>
            <p className="text-[10px] font-bold uppercase text-slate-400">Completed</p>
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition
                    ${filter === f.value ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3">{error}</div>}

      {!jobs && <div className="card p-10 text-center text-slate-400">Loading…</div>}
      {jobs && !jobs.length && (
        <div className="card p-10 text-center">
          <p className="text-3xl mb-2">✂️</p>
          <p className="font-bold text-slate-700">No jobs assigned yet</p>
          <p className="text-xs text-slate-400 mt-1">When the shop assigns you an order it appears here automatically.</p>
        </div>
      )}

      {jobs?.map((j) => (
        <div key={j.id} className="card p-4">
          <Link href={`/tailor/jobs/${j.id}`} className="block">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-extrabold text-slate-800">{j.order_no}</p>
                <p className="text-sm font-semibold text-slate-600 truncate">{j.customer_name}</p>
                <p className="text-xs text-slate-400 capitalize mt-0.5">{j.garments || '—'}</p>
              </div>
              <StatusBadge status={j.status} />
            </div>
            <p className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 mt-2">
              <IconCalendar size={13} /> Deliver by {fmtDate(j.delivery_date)}
            </p>
          </Link>
          <div className="flex gap-2 mt-3">
            <Link href={`/tailor/jobs/${j.id}`} className="btn-outline flex-1 !py-2.5 text-sm">
              📏 Measurements
            </Link>
            {j.status === 'in_progress' && (
              <button onClick={() => setStatus(j, 'completed')} disabled={busy === j.id}
                      className="btn flex-1 !py-2.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700">
                ✓ Mark Completed
              </button>
            )}
            {j.status === 'pending' && (
              <button onClick={() => setStatus(j, 'in_progress')} disabled={busy === j.id}
                      className="btn flex-1 !py-2.5 text-sm bg-blue-600 text-white hover:bg-blue-700">
                ▶ Start Work
              </button>
            )}
            {j.status === 'completed' && (
              <button onClick={() => setStatus(j, 'in_progress')} disabled={busy === j.id}
                      className="btn-outline flex-1 !py-2.5 text-sm">
                ↩ Back to In Progress
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
