'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate, garmentLabel, TROUSER_FIELDS, COAT_FIELDS, getUser } from '@/lib/api';
import { StatusBadge } from '@/components/Badges';
import { IconScissors, IconPrint } from '@/components/Icons';
import SearchSelect from '@/components/SearchSelect';
import Pagination, { usePagination } from '@/components/Pagination';
import { T } from '@/lib/labels';

export default function TailoringPage() {
  const [orders, setOrders] = useState([]);
  const [tailors, setTailors] = useState([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignFor, setAssignFor] = useState(null);
  const [assignTailorId, setAssignTailorId] = useState('');
  const [detailsFor, setDetailsFor] = useState(null); // order id whose details are open
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const { paged, controls } = usePagination(orders, [status, search, unassignedOnly]);
  const user = typeof window !== 'undefined' ? getUser() : null;
  const canComplete = ['admin', 'superadmin'].includes(user?.role); // master tailor starts work only — the salesman completes it

  useEffect(() => {
    api('/users/tailors').then(setTailors).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (search) q.set('search', search);
    if (unassignedOnly) q.set('unassigned', '1');
    api(`/orders/tailoring?${q}`).then(setOrders).catch((e) => setError(e.message));
  }, [status, search, unassignedOnly]);

  useEffect(() => { load(); }, [load]);

  async function setJobStatus(order, newStatus) {
    setBusy(true); setError('');
    try {
      await api(`/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
      load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  async function assignTailor(e) {
    e.preventDefault();
    if (!assignTailorId) return;
    setBusy(true); setError('');
    try {
      await api(`/orders/${assignFor.id}/tailor`, {
        method: 'PATCH',
        body: JSON.stringify({ tailor_id: Number(assignTailorId) }),
      });
      setAssignFor(null);
      setAssignTailorId('');
      load();
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  }

  async function openDetails(order) {
    setDetailsFor(order.id);
    setDetails(null);
    setDetailsLoading(true);
    try {
      const d = await api(`/orders/${order.id}/job-sheet`);
      setDetails(d);
    } catch (e) { setError(e.message); }
    setDetailsLoading(false);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        <span className="chip-green mr-2">No money shown</span>
        Jobs still in the workshop — delivered &amp; cancelled orders don&apos;t appear here.
      </p>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      <div className="card p-4 flex flex-wrap gap-3">
        <input className="input max-w-[200px]" placeholder="Search order no… e.g. 1046"
               value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 px-1">
          <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={unassignedOnly}
                 onChange={(e) => setUnassignedOnly(e.target.checked)} />
          Unassigned only
        </label>
      </div>

      {/* Card list — deliberately few fields per card so this reads well on a phone.
          Full detail is one tap away via "Details", and everything still prints. */}
      <div className="space-y-2.5">
        {paged.map((o) => (
          <div key={o.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-bold text-slate-700">{o.order_no}</span>
                <p className="text-sm text-slate-600 capitalize mt-0.5">{(o.garments || '—').replaceAll('_', ' ')}</p>
              </div>
              <StatusBadge status={o.status} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-xs text-slate-500">
              <span>📅 {fmtDate(o.delivery_date)}</span>
              <span>
                {o.tailor_id
                  ? <span className="font-mono text-slate-600">{o.tailor_staff_no} <span className="font-sans">— {o.tailor_name}</span></span>
                  : <span className="chip-amber">Unassigned</span>}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              <button disabled={busy}
                      onClick={() => { setAssignFor(o); setAssignTailorId(o.tailor_id ? String(o.tailor_id) : ''); }}
                      className="btn-outline !px-2.5 !py-1.5 text-xs" title={`${T.assign} / ${T.change}`}>
                <IconScissors size={13} /> {o.tailor_id ? T.change : T.assign}
              </button>
              {o.status === 'pending' && (
                <button disabled={busy} onClick={() => setJobStatus(o, 'in_progress')}
                        className="btn !px-2.5 !py-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700">
                  Start
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
              <button onClick={() => openDetails(o)} className="btn-outline !px-2.5 !py-1.5 text-xs">
                Details
              </button>
              <Link href={`/print/job/${o.id}`} className="btn-outline !px-2.5 !py-1.5 text-xs" title="Print job sheet">
                <IconPrint size={14} />
              </Link>
            </div>
          </div>
        ))}
        {!orders.length && <div className="card p-6 text-center text-slate-400">No jobs found.</div>}
      </div>

      <Pagination {...controls} />

      {/* Assign tailor modal */}
      {assignFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={assignTailor} className="card p-6 w-full max-w-sm space-y-4 max-h-[88vh] overflow-y-auto">
            <div>
              <h2 className="font-bold text-lg text-slate-800">✂️ {assignFor.tailor_id ? T.change : T.assign} Tailor</h2>
              <p className="text-sm text-slate-500">
                {assignFor.order_no} · {assignFor.customer_name}
                {assignFor.tailor_name && <> — currently: <b>{assignFor.tailor_staff_no} — {assignFor.tailor_name}</b></>}
              </p>
            </div>
            <div>
              <label className="label">Tailor — search by staff number or name</label>
              <SearchSelect
                placeholder="e.g. ST003 or name"
                value={assignTailorId}
                onChange={setAssignTailorId}
                options={tailors.map((t) => ({
                  value: t.id, label: `${t.staff_no ? t.staff_no + ' — ' : ''}${t.name}`, hint: t.phone,
                  search: `${t.staff_no || ''} ${t.name} ${t.phone || ''}`,
                }))}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setAssignFor(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1" disabled={busy || !assignTailorId}>
                {busy ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Details modal — full job info, on screen, no money, no printing controls in the sheet itself */}
      {detailsFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto space-y-4">
            {detailsLoading && <p className="text-sm text-slate-400 text-center py-6">Loading…</p>}
            {details && (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-bold text-lg text-slate-800">{details.order_no}</h2>
                    <p className="text-sm text-slate-500">{details.customer_name}</p>
                  </div>
                  <StatusBadge status={details.status} />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-400">{T.appointment}</p>
                    <p className="font-semibold text-slate-700">{fmtDate(details.delivery_date)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-400">Taken On</p>
                    <p className="font-semibold text-slate-700">{details.claimed_at ? fmtDate(details.claimed_at) : '—'}</p>
                  </div>
                </div>

                {details.tailor_name && (
                  <p className="text-sm"><b>Tailor:</b> {details.tailor_staff_no} — {details.tailor_name}</p>
                )}
                {details.notes && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
                    <b>Notes:</b> {details.notes}
                  </div>
                )}

                <div>
                  <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700 border-b-2 border-brand-600 inline-block pb-1 mb-2">
                    Items
                  </p>
                  {details.items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between py-1 border-b border-slate-100 text-sm">
                      <span className="font-semibold">{it.qty} × {garmentLabel(it.garment_type)}</span>
                      <span className="text-xs text-slate-500">
                        {it.fabric_code
                          ? `${it.fabric_code}${it.fabric_color ? ` · ${it.fabric_color}` : ''}${Number(it.meters) > 0 ? ` · ${it.meters}m` : ''}`
                          : "Customer's own fabric"}
                      </span>
                    </div>
                  ))}
                </div>

                {(() => {
                  const m = details.measurements || {};
                  const trouser = TROUSER_FIELDS.filter(([k]) => m.trouser?.[k]);
                  const coat = COAT_FIELDS.filter(([k]) => m.coat?.[k]);
                  if (!trouser.length && !coat.length) return null;
                  return (
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700 border-b-2 border-brand-600 inline-block pb-1 mb-2">
                        Measurements
                      </p>
                      <div className="grid grid-cols-2 gap-x-6">
                        {trouser.length > 0 && (
                          <div>
                            <p className="text-[10px] font-extrabold uppercase text-slate-500 mb-1">Trouser / Shalwar</p>
                            {trouser.map(([k, l]) => (
                              <div key={k} className="flex justify-between text-sm py-0.5">
                                <span className="text-slate-500">{l}</span><b>{m.trouser[k]}</b>
                              </div>
                            ))}
                          </div>
                        )}
                        {coat.length > 0 && (
                          <div>
                            <p className="text-[10px] font-extrabold uppercase text-slate-500 mb-1">Coat / Kameez</p>
                            {coat.map(([k, l]) => (
                              <div key={k} className="flex justify-between text-sm py-0.5">
                                <span className="text-slate-500">{l}</span><b>{m.coat[k]}</b>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
            <div className="flex gap-2 pt-2">
              {details && (
                <Link href={`/print/job/${details.id}`} className="btn-outline flex-1 justify-center">
                  <IconPrint size={14} /> Print
                </Link>
              )}
              <button className="btn-primary flex-1" onClick={() => { setDetailsFor(null); setDetails(null); }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
