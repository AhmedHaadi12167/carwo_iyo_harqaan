'use client';
import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, money, fmtDate, getUser, GARMENTS, garmentLabel, PAYMENT_METHODS } from '@/lib/api';
import { StatusBadge, PayBadge, STATUS_LABELS } from '@/components/Badges';
import {
  IconPrint, IconMoney, IconX, IconScissors, IconSearch, IconCalendar,
  IconEye, IconTruck, IconTrash, IconUndo, IconCheck,
} from '@/components/Icons';
import SearchSelect from '@/components/SearchSelect';
import ActionMenu from '@/components/ActionMenu';
import DateRangePicker, { todayIso } from '@/components/DateRangePicker';
import Pagination, { usePagination } from '@/components/Pagination';
import { T } from '@/lib/labels';

// A salesman moves an order forward one step at a time — they pick the NEXT
// state, never an arbitrary one, so an order cannot skip the workshop.
const NEXT_STEP = {
  pending: { status: 'in_progress', label: T.start },
  in_progress: { status: 'completed', label: T.complete },
  completed: { status: 'delivered', label: T.deliver },
};

// What one line on the order is, shown as a coloured chip. The colour alone
// tells the counter whether this order needs the workshop (tolid) or is just
// goods going over the counter.
const LINE_CHIP = {
  tailoring: 'bg-brand-50 text-brand-700 ring-brand-200',
  fabric: 'bg-amber-50 text-amber-700 ring-amber-200',
  product: 'bg-violet-50 text-violet-700 ring-violet-200',
};

// Fabric is sold by length, everything else by count — so a fabric line reads
// "SS0098 · 3 yd" and a garment line reads "Suit ×3".
function ItemChips({ items }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((it, i) => (
        <span key={i}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-bold ring-1 ring-inset
                          ${LINE_CHIP[it.line_type] || 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
          {it.line_type === 'tailoring' ? garmentLabel(it.label) : it.label}
          {it.line_type === 'fabric'
            ? <span className="font-medium opacity-70">{Number(it.yards || 0)} yd</span>
            : Number(it.qty) > 1 && <span className="font-medium opacity-70">×{it.qty}</span>}
        </span>
      ))}
    </div>
  );
}

// Late work should be obvious at a glance, without reading dates.
function DeliveryCell({ date, status }) {
  if (!date) return <span className="text-slate-300">{T.noDate}</span>;
  const done = status === 'delivered' || status === 'cancelled';
  const today = todayIso();
  const iso = String(date).slice(0, 10);
  const late = !done && iso < today;
  const isToday = !done && iso === today;
  return (
    <span className={`font-semibold ${late ? 'text-rose-600' : isToday ? 'text-amber-600' : 'text-slate-600'}`}>
      {fmtDate(date)}
      {late && <span className="block text-[10px] font-bold uppercase tracking-wide">Dib u dhac</span>}
      {isToday && <span className="block text-[10px] font-bold uppercase tracking-wide">{T.today2}</span>}
    </span>
  );
}

function OrdersInner() {
  const params = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState(params.get('status') || '');
  const [payStatus, setPayStatus] = useState('');
  const [garment, setGarment] = useState('');
  const [lineType, setLineType] = useState('');
  const [search, setSearch] = useState(params.get('search') || '');
  // Dates are off until asked for. Most of the time the counter wants "what
  // is open right now", not a period — turning the range on by default would
  // silently hide older unfinished work.
  const [useDates, setUseDates] = useState(false);
  const [range, setRange] = useState({ from: todayIso(), to: todayIso() });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [collectFor, setCollectFor] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payDate, setPayDate] = useState('');
  const [tailors, setTailors] = useState([]);
  const [assignFor, setAssignFor] = useState(null);
  const [assignTailorId, setAssignTailorId] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const user = typeof window !== 'undefined' ? getUser() : null;
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const isCashier = user?.role === 'cashier';

  // lineType is filtered in the browser (the list already carries line_types),
  // so it is not part of the server query.
  const visible = useMemo(
    () => (lineType ? orders.filter((o) => (o.line_types || '').split(',').includes(lineType)) : orders),
    [orders, lineType]
  );
  const { paged, controls } = usePagination(
    visible, [search, status, payStatus, garment, lineType, showDeleted, useDates, range.from, range.to]
  );

  useEffect(() => {
    if (!isCashier) api('/users/tailors').then(setTailors).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (payStatus) q.set('payment_status', payStatus);
    if (garment) q.set('garment', garment);
    if (search) q.set('search', search);
    if (showDeleted) q.set('deleted', '1');
    if (useDates && range.from) q.set('from', range.from);
    if (useDates && range.to) q.set('to', range.to);
    api(`/orders?${q}`).then(setOrders).catch((e) => setError(e.message));
  }, [status, payStatus, garment, search, showDeleted, useDates, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  // How many filters are narrowing the list right now — shown on the clear
  // button so an empty table is never a mystery.
  const activeFilters =
    [status, payStatus, garment, lineType, search].filter(Boolean).length + (useDates ? 1 : 0);

  function clearFilters() {
    setStatus(''); setPayStatus(''); setGarment(''); setLineType(''); setSearch(''); setUseDates(false);
  }

  async function changeStatus(order, newStatus) {
    if (newStatus === 'cancelled' &&
        !confirm(`Cancel order ${order.order_no}? Fabric and stock return to the shelf.`)) return;
    setBusy(true); setError('');
    try {
      await api(`/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
      load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  // Nothing is destroyed: the order is hidden from every list, report and
  // total, and can be brought back with Restore. Stock is NOT returned — use
  // Cancel for that, since cancelling is what actually means the goods came
  // back.
  async function deleteOrder(order) {
    if (!confirm(
      `Delete order ${order.order_no}?\n\n` +
      `It disappears from orders, reports and all money totals. Nothing is ` +
      `erased — tick "${T.deleted}" to find it again and restore it.\n\n` +
      `Stock is not returned; use Cancel for that.`
    )) return;
    setBusy(true); setError('');
    try {
      await api(`/orders/${order.id}`, { method: 'DELETE' });
      load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  async function restoreOrder(order) {
    if (!confirm(`Restore order ${order.order_no}? It goes back into the lists and totals.`)) return;
    setBusy(true); setError('');
    try {
      await api(`/orders/${order.id}/restore`, { method: 'POST' });
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

  async function collect(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api(`/orders/${collectFor.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(payAmount), method: payMethod, payment_date: payDate || null }),
      });
      setCollectFor(null);
      setPayAmount('');
      setPayDate('');
      load();
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">{T.orders}</h1>
          <p className="text-xs text-slate-400">
            {visible.length} {T.orders.toLowerCase()}
            {activeFilters > 0 && <> · {activeFilters} filter</>}
          </p>
        </div>
        {!isCashier && <Link href="/orders/new" className="btn-primary">+ {T.newOrder}</Link>}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      {/* ---- Filter bar: search + dates on top, the narrow selects below ---- */}
      <div className="card p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <IconSearch size={15} />
            </span>
            <input className="input !pl-8 !py-1.5 !text-xs w-full" placeholder={`${T.search}…`}
                   value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <button type="button" onClick={() => setUseDates(!useDates)}
                  className={`btn !px-2.5 !py-1.5 text-xs font-bold border transition ${
                    useDates ? 'border-brand-400 bg-brand-50 text-brand-700'
                             : 'border-slate-200 text-slate-500 hover:border-brand-300'}`}>
            <IconCalendar size={14} /> {useDates ? T.clearDate : T.filterByDate}
          </button>

          {activeFilters > 0 && (
            <button type="button" onClick={clearFilters}
                    className="btn !px-2.5 !py-1.5 text-xs font-bold border border-rose-200 text-rose-600 hover:bg-rose-50">
              <IconX size={13} /> {T.clear} ({activeFilters})
            </button>
          )}
        </div>

        {useDates && (
          <div className="pt-0.5">
            <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select className="input !py-1.5 !text-xs max-w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{T.allStatuses}</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="input !py-1.5 !text-xs max-w-[150px]" value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>
            <option value="">{T.allPayments}</option>
            <option value="paid">{T.fullyPaid}</option>
            <option value="partial">{T.partial}</option>
            <option value="unpaid">{T.unpaid}</option>
          </select>
          <select className="input !py-1.5 !text-xs max-w-[150px]" value={lineType} onChange={(e) => setLineType(e.target.value)}>
            <option value="">{T.allTypes}</option>
            <option value="tailoring">{T.lineTailoring}</option>
            <option value="fabric">{T.lineFabric}</option>
            <option value="product">{T.lineProduct}</option>
          </select>
          <select className="input !py-1.5 !text-xs max-w-[150px]" value={garment} onChange={(e) => setGarment(e.target.value)}>
            <option value="">{T.allGarments}</option>
            {GARMENTS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 cursor-pointer px-1">
              <input type="checkbox" className="w-3.5 h-3.5 accent-brand-600" checked={showDeleted}
                     onChange={(e) => setShowDeleted(e.target.checked)} />
              {T.deleted}
            </label>
          )}
        </div>
      </div>

      {/* ---- The list ---- */}
      <div className="card overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="border-b border-slate-100 bg-slate-50/60">
            <th className="th">{T.orders}</th><th className="th">{T.customer}</th><th className="th">{T.garments}</th>
            <th className="th">{T.delivery}</th><th className="th">{T.status}</th><th className="th">{T.payment}</th>
            <th className="th text-right">{T.price}</th><th className="th text-right">{T.balance}</th>
            <th className="th text-right">{T.actions}</th>
          </tr></thead>
          <tbody>
            {paged.map((o) => {
              const balance = Number(o.balance);
              const next = NEXT_STEP[o.status];
              const open = o.status !== 'cancelled' && o.status !== 'delivered';
              return (
                <tr key={o.id}
                    className={`table-row ${
                      o.deleted_at ? 'opacity-50 line-through decoration-rose-400'
                      : o.status === 'delivered' && o.payment_status === 'paid' ? 'bg-emerald-50/60'
                      : o.payment_status === 'unpaid' && o.status !== 'cancelled' ? 'bg-rose-50/50'
                      : o.status === 'completed' ? 'bg-violet-50/40' : ''}`}>
                  <td className="td">
                    {isAdmin
                      ? <Link href={`/orders/${o.id}`} className="font-bold text-brand-700 hover:underline">{o.order_no}</Link>
                      : <span className="font-bold text-slate-700">{o.order_no}</span>}
                    <p className="text-[10.5px] text-slate-400">{fmtDate(o.created_at)}</p>
                  </td>
                  <td className="td">
                    <p className="font-semibold text-slate-700">{o.customer_name}</p>
                    {/* Phone is visible to counter staff too, so anyone handling
                        the order can call about a fitting or a pickup. */}
                    {o.customer_phone && (
                      <a href={`tel:${o.customer_phone}`}
                         className="text-[10.5px] text-brand-600 hover:underline font-medium">
                        {o.customer_phone}
                      </a>
                    )}
                    {o.tailor_name && (
                      <p className="text-[10.5px] text-slate-400">
                        {o.tailor_staff_no ? `${o.tailor_staff_no} — ` : ''}{o.tailor_name}
                      </p>
                    )}
                  </td>
                  <td className="td"><ItemChips items={o.item_summary} /></td>
                  <td className="td"><DeliveryCell date={o.delivery_date} status={o.status} /></td>
                  <td className="td"><StatusBadge status={o.status} /></td>
                  <td className="td"><PayBadge status={o.payment_status} /></td>
                  <td className="td text-right font-semibold">{money(o.price)}</td>
                  <td className={`td text-right font-extrabold ${balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {money(o.balance)}
                  </td>
                  <td className="td text-right">
                    {/* One handle per row. Falsy entries are dropped by
                        ActionMenu, so each line can carry its own condition. */}
                    <ActionMenu label={T.actions} items={[
                      balance > 0 && o.status !== 'cancelled' && {
                        label: T.collect, icon: <IconMoney size={15} />,
                        onClick: () => { setCollectFor(o); setPayAmount(''); setPayMethod('cash'); setPayDate(''); },
                      },
                      // Salesman advances the job one step; the admin uses the
                      // details page, where the whole history is visible.
                      !isAdmin && !isCashier && next && o.status !== 'cancelled' && {
                        label: next.label,
                        icon: next.status === 'delivered' ? <IconTruck size={15} /> : <IconCheck size={15} />,
                        onClick: () => changeStatus(o, next.status),
                      },
                      // Assign tailor: salesman only while unassigned, admin
                      // any time — never a cashier.
                      !isCashier && open && (isAdmin || !o.tailor_id) && {
                        label: `${o.tailor_id ? T.change : T.assign} ${T.tailors}`,
                        icon: <IconScissors size={14} />,
                        onClick: () => { setAssignFor(o); setAssignTailorId(o.tailor_id ? String(o.tailor_id) : ''); },
                      },
                      isAdmin && {
                        label: T.view, icon: <IconEye size={15} />,
                        onClick: () => { window.location.href = `/orders/${o.id}`; },
                      },
                      !isCashier && {
                        label: T.printReceipt, icon: <IconPrint size={15} />,
                        onClick: () => window.open(`/print/${o.id}`, '_blank'),
                      },
                      !isCashier && {
                        label: T.printJobSheet, icon: <IconScissors size={14} />,
                        onClick: () => window.open(`/print/job/${o.id}`, '_blank'),
                      },
                      isAdmin && open && {
                        label: T.cancelOrder, icon: <IconX size={15} />, danger: true,
                        onClick: () => changeStatus(o, 'cancelled'),
                      },
                      isAdmin && (o.deleted_at
                        ? { label: T.restoreOrder, icon: <IconUndo size={15} />, onClick: () => restoreOrder(o) }
                        : { label: T.deleteOrder, icon: <IconTrash size={15} />, danger: true, onClick: () => deleteOrder(o) }),
                    ]} />
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr><td className="td text-center text-slate-400 py-8" colSpan={9}>
                {T.noOrders}
                {activeFilters > 0 && (
                  <button type="button" onClick={clearFilters}
                          className="block mx-auto mt-2 text-xs font-bold text-brand-600 hover:underline">
                    {T.clear}
                  </button>
                )}
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination {...controls} />
      </div>

      {/* Assign tailor */}
      {assignFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={assignTailor} className="card p-6 w-full max-w-sm space-y-4 max-h-[88vh] overflow-y-auto">
            <div>
              <h2 className="font-bold text-lg text-slate-800">{assignFor.tailor_id ? T.change : T.assign} {T.tailors}</h2>
              <p className="text-sm text-slate-500">
                {assignFor.order_no} · {assignFor.customer_name}
                {assignFor.tailor_name && <> — <b>{assignFor.tailor_staff_no ? `${assignFor.tailor_staff_no} — ` : ''}{assignFor.tailor_name}</b></>}
              </p>
            </div>
            <div>
              <label className="label">{T.tailors}</label>
              <SearchSelect
                placeholder="ST003"
                value={assignTailorId}
                onChange={setAssignTailorId}
                options={tailors.map((t) => ({
                  value: t.id, label: `${t.staff_no ? t.staff_no + ' — ' : ''}${t.name}`, hint: t.phone,
                  search: `${t.staff_no || ''} ${t.name} ${t.phone || ''}`,
                }))}
              />
            </div>
            {!isAdmin && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Once assigned, only the admin can change the tailor.
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setAssignFor(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1" disabled={busy || !assignTailorId}>
                {busy ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Collect payment */}
      {collectFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={collect} className="card p-6 w-full max-w-sm space-y-4 max-h-[88vh] overflow-y-auto">
            <div>
              <h2 className="font-bold text-lg text-slate-800">{T.collect}</h2>
              <p className="text-sm text-slate-500">
                {collectFor.order_no} · {collectFor.customer_name} — {T.balance}{' '}
                <b className="text-rose-600">{money(collectFor.balance)}</b>
              </p>
            </div>
            <div>
              <label className="label">Amount ($)</label>
              <input className="input text-lg font-bold" type="number" step="0.01" min="0.01"
                     max={Number(collectFor.balance)} autoFocus required
                     value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                     placeholder={`Up to ${money(collectFor.balance)}`} />
              <button type="button" className="text-xs font-bold text-brand-600 mt-1 hover:underline"
                      onClick={() => setPayAmount(String(collectFor.balance))}>
                Collect full balance
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Method</label>
                <select className="input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setCollectFor(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : 'Receive Payment'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  return <Suspense fallback={null}><OrdersInner /></Suspense>;
}
