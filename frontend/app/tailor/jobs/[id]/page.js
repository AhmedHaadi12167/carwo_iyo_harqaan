'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, fmtDate, garmentLabel, TROUSER_FIELDS, COAT_FIELDS } from '@/lib/api';
import { StatusBadge } from '@/components/Badges';
import { T } from '@/lib/labels';

export default function JobDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/tailor/my/${id}`).then(setJob).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(status) {
    setBusy(true);
    setError('');
    try {
      await api(`/tailor/my/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (error && !job) return <div className="card p-6 text-rose-600">{error}</div>;
  if (!job) return <div className="card p-10 text-center text-slate-400">Loading job…</div>;

  const m = job.measurements || {};
  const trouser = TROUSER_FIELDS.filter(([k]) => m.trouser?.[k]);
  const coat = COAT_FIELDS.filter(([k]) => m.coat?.[k]);

  return (
    <div className="space-y-3">
      <button onClick={() => router.push('/tailor')} className="text-sm font-bold text-slate-400">← My Jobs</button>

      {/* Header card */}
      <div className="card p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-extrabold text-slate-800">{job.order_no}</p>
            <p className="font-semibold text-slate-600">{job.customer_name}</p>
          </div>
          <StatusBadge status={job.status} />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-center">
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] font-bold uppercase text-slate-400">Deliver By</p>
            <p className="font-extrabold text-slate-700 text-sm mt-0.5">{fmtDate(job.delivery_date)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] font-bold uppercase text-slate-400">Taken On</p>
            <p className="font-extrabold text-slate-700 text-sm mt-0.5">{fmtDate(job.claimed_at)}</p>
          </div>
        </div>
        {job.notes && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm text-amber-800">
            📝 {job.notes}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="card p-4">
        <p className="font-bold text-slate-800 mb-2">What to make</p>
        {job.items.map((it, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
            <div>
              <p className="font-bold text-slate-700">{it.qty} × {garmentLabel(it.garment_type)}</p>
              <p className="text-xs text-slate-400">
                {it.fabric_code
                  ? `${it.fabric_code} · ${it.fabric_name}${it.fabric_color ? ` · ${it.fabric_color}` : ''}`
                  : 'Customer’s own fabric'}
              </p>
            </div>
            {Number(it.meters) > 0 && (
              <span className="chip-blue">{it.meters} m</span>
            )}
          </div>
        ))}
      </div>

      {/* Measurements — big and readable for the workshop */}
      <div className="card p-4">
        <p className="font-bold text-slate-800 mb-3">📏 Measurements</p>
        {trouser.length > 0 && (
          <>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-600 mb-1.5">Trouser / Shalwar</p>
            <div className="grid grid-cols-2 gap-x-4 mb-4">
              {trouser.map(([k, l]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-dashed border-slate-200">
                  <span className="text-sm text-slate-500">{l}</span>
                  <span className="text-[15px] font-extrabold text-slate-800">{m.trouser[k]}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {coat.length > 0 && (
          <>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-600 mb-1.5">Coat / Kameez</p>
            <div className="grid grid-cols-2 gap-x-4">
              {coat.map(([k, l]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-dashed border-slate-200">
                  <span className="text-sm text-slate-500">{l}</span>
                  <span className="text-[15px] font-extrabold text-slate-800">{m.coat[k]}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {!trouser.length && !coat.length && <p className="text-sm text-slate-400">No measurements recorded.</p>}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3">{error}</div>}

      {/* Status actions — big thumb buttons */}
      {job.status === 'pending' && (
        <button onClick={() => setStatus('in_progress')} disabled={busy}
                className="btn w-full !py-4 text-base bg-blue-600 text-white hover:bg-blue-700 sticky bottom-24">
          ▶ {T.start}
        </button>
      )}
      {job.status === 'in_progress' && (
        <button onClick={() => setStatus('completed')} disabled={busy}
                className="btn w-full !py-4 text-base bg-emerald-600 text-white hover:bg-emerald-700 sticky bottom-24">
          ✓ {T.complete}
        </button>
      )}
      {job.status === 'completed' && (
        <button onClick={() => setStatus('in_progress')} disabled={busy}
                className="btn-outline w-full !py-4 text-base sticky bottom-24">
          ↩ Reopen — {T.inProgress}
        </button>
      )}
      {job.status === 'delivered' && (
        <p className="text-center text-sm font-bold text-emerald-600 py-2">✓ Delivered to the customer</p>
      )}
    </div>
  );
}
