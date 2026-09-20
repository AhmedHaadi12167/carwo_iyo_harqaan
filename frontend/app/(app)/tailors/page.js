'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate, getUser } from '@/lib/api';
import { StatusBadge } from '@/components/Badges';
import { IconPrint } from '@/components/Icons';
import SearchSelect from '@/components/SearchSelect';
import { T } from '@/lib/labels';

const PERIODS = [
  { key: 'daily', label: T.today },
  { key: 'weekly', label: T.thisWeek },
  { key: 'monthly', label: T.thisMonth },
  { key: 'all', label: T.allTime },
];

export default function TailorsPage() {
  const [period, setPeriod] = useState('daily');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // Per-tailor job queue — search a staff number and see exactly what that
  // tailor still has to work on. Master tailor can Start work; only the
  // salesman (or admin) marks a job Complete.
  const [tailors, setTailors] = useState([]);
  const [queueTailorId, setQueueTailorId] = useState('');
  const [queue, setQueue] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const user = typeof window !== 'undefined' ? getUser() : null;
  const canComplete = ['admin', 'superadmin'].includes(user?.role); // master tailor starts work only — the salesman completes it

  const load = useCallback(() => {
    api(`/orders/tailor-performance?period=${period}`).then(setData).catch((e) => setError(e.message));
  }, [period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/users/tailors').then(setTailors).catch(() => {}); }, []);

  const loadQueue = useCallback(() => {
    if (!queueTailorId) { setQueue([]); return; }
    setQueueLoading(true);
    api(`/orders/tailoring?tailor_id=${queueTailorId}`)
      .then(setQueue)
      .catch((e) => setError(e.message))
      .finally(() => setQueueLoading(false));
  }, [queueTailorId]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  async function setJobStatus(order, newStatus) {
    setBusy(true); setError('');
    try {
      await api(`/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
      loadQueue();
      load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const tailorList = data?.tailors || [];
  const totalCompleted = tailorList.reduce((a, t) => a + t.completed_jobs, 0);
  const totalGarments = tailorList.reduce((a, t) => a + t.garments_made, 0);
  const queueTailor = tailors.find((t) => String(t.id) === String(queueTailorId));

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        <span className="chip-green mr-2">No money shown</span>
        Performance by period, or search a staff number to see one tailor&apos;s job queue.
      </p>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      {/* ================= Per-tailor job queue ================= */}
      <div className="card p-4 space-y-4">
        <div>
          <label className="label">🔍 Find a tailor — staff number or name</label>
          <SearchSelect
            placeholder="e.g. ST003 or name"
            value={queueTailorId}
            onChange={setQueueTailorId}
            options={tailors.map((t) => ({
              value: t.id, label: `${t.staff_no ? t.staff_no + ' — ' : ''}${t.name}`, hint: t.phone,
              search: `${t.staff_no || ''} ${t.name} ${t.phone || ''}`,
            }))}
          />
        </div>

        {queueTailorId && (
          <div className="space-y-2.5">
            <p className="text-sm font-bold text-slate-700">
              {queueTailor?.staff_no} — {queueTailor?.name}&apos;s active orders
            </p>
            {queueLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {!queueLoading && !queue.length && (
              <p className="text-sm text-slate-400">No active orders assigned to this tailor.</p>
            )}
            {queue.map((o) => (
              <div key={o.id} className="border border-slate-100 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold text-slate-700">{o.order_no}</span>
                    <p className="text-sm text-slate-600 capitalize mt-0.5">{(o.garments || '—').replaceAll('_', ' ')}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <p className="text-xs text-slate-500 mt-1.5">📅 {T.appointment}: {fmtDate(o.delivery_date)}</p>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {o.status === 'pending' && (
                    <button disabled={busy} onClick={() => setJobStatus(o, 'in_progress')}
                            className="btn !px-2.5 !py-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700">
                      Start Work
                    </button>
                  )}
                  {o.status === 'in_progress' && canComplete && (
                    <button disabled={busy} onClick={() => setJobStatus(o, 'completed')}
                            className="btn !px-2.5 !py-1.5 text-xs bg-emerald-600 text-white hover:bg-emerald-700">
                      Complete
                    </button>
                  )}
                  {o.status === 'in_progress' && !canComplete && (
                    <span className="chip-amber !text-xs self-center">In progress — salesman completes</span>
                  )}
                  {o.status === 'completed' && (
                    <span className="chip-green !text-xs">{T.ready} — take the garment</span>
                  )}
                  <Link href={`/print/job/${o.id}`} className="btn-outline !px-2.5 !py-1.5 text-xs" title="Print job sheet">
                    <IconPrint size={14} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ================= Performance by period ================= */}
      <div className="card p-2 flex flex-wrap gap-1">
        {PERIODS.map((p) => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-bold transition ${
                    period === p.key ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-400">Jobs Completed</p>
          <p className="text-2xl font-extrabold text-brand-700 mt-1">{totalCompleted}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-400">Garments Made</p>
          <p className="text-2xl font-extrabold text-brand-700 mt-1">{totalGarments}</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-slate-100 bg-slate-50/60">
            <th className="th">Staff No</th><th className="th">Tailor</th>
            <th className="th text-right">Completed</th><th className="th text-right">Garments</th>
            <th className="th text-right">In Progress Now</th>
          </tr></thead>
          <tbody>
            {tailorList.map((t) => (
              <tr key={t.id} className="table-row cursor-pointer" onClick={() => setQueueTailorId(String(t.id))}>
                <td className="td font-mono text-xs text-slate-600">{t.staff_no || '—'}</td>
                <td className="td font-semibold text-slate-700">{t.name}</td>
                <td className="td text-right font-extrabold text-emerald-600">{t.completed_jobs}</td>
                <td className="td text-right">{t.garments_made}</td>
                <td className="td text-right text-slate-500">{t.in_progress_now}</td>
              </tr>
            ))}
            {!tailorList.length && <tr><td className="td text-slate-400" colSpan={5}>No tailors found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
