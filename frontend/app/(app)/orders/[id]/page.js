'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, money, fmtDate, getUser, garmentLabel, TROUSER_FIELDS, COAT_FIELDS, PAYMENT_METHODS, paymentMethodLabel } from '@/lib/api';
import { StatusBadge, PayBadge, STATUS_LABELS } from '@/components/Badges';
import { T } from '@/lib/labels';

export default function OrderDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payDate, setPayDate] = useState(''); // optional — blank = today
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    price: '', delivery_date: '', notes: '',
    customer_name: '', customer_phone: '',
    trouser: {}, coat: {},
  });
  const user = typeof window !== 'undefined' ? getUser() : null;
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const load = useCallback(() => {
    api(`/orders/${id}`).then(setOrder).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    // Order details are for admins; salesmen work from the orders list
    if (user && !isAdmin) { router.replace('/orders'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function changeStatus(status) {
    if (status === 'cancelled' && !confirm('Cancel this order? Fabric will be returned to stock.')) return;
    setBusy(true); setError('');
    try {
      await api(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  async function deleteOrder() {
    if (!confirm(`Permanently DELETE order ${order.order_no}? This cannot be undone — items, payments, and history will all be erased. Fabric used will be returned to stock.`)) return;
    setBusy(true); setError('');
    try {
      await api(`/orders/${id}`, { method: 'DELETE' });
      router.push('/orders');
    } catch (e) { setError(e.message); setBusy(false); }
  }

  function openEdit() {
    const m = order.measurements || {};
    setEditForm({
      price: order.price,
      vat_method: order.vat_method || 'cash',
      delivery_date: order.delivery_date ? order.delivery_date.slice(0, 10) : '',
      notes: order.notes || '',
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      trouser: { ...(m.trouser || {}) },
      coat: { ...(m.coat || {}) },
    });
    setEditing(true);
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editForm.customer_name.trim() || editForm.customer_name.trim().length < 3) {
      setError('Customer name must be at least 3 characters.'); return;
    }
    if (editForm.customer_phone && !/^\+?[0-9\s-]{7,15}$/.test(editForm.customer_phone.trim())) {
      setError('Enter a valid phone number (digits, 7–15 characters).'); return;
    }
    if (!Number(editForm.price) || Number(editForm.price) <= 0) {
      setError('Price must be greater than zero.'); return;
    }
    setBusy(true); setError('');
    try {
      await Promise.all([
        api(`/orders/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            price: Number(editForm.price),
            vat_method: editForm.vat_method,
            delivery_date: editForm.delivery_date || null,
            notes: editForm.notes,
            measurements: { trouser: editForm.trouser, coat: editForm.coat },
          }),
        }),
        api(`/customers/${order.customer_id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: editForm.customer_name, phone: editForm.customer_phone }),
        }),
      ]);
      setEditing(false);
      load();
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  }

  async function deletePayment(p) {
    if (!confirm(`Delete this ${money(p.amount)} payment entry? The balance will increase again.`)) return;
    setBusy(true); setError('');
    try {
      await api(`/orders/${id}/payments/${p.id}`, { method: 'DELETE' });
      load();
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  }

  async function addPayment(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api(`/orders/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(payAmount), method: payMethod, payment_date: payDate || null }),
      });
      setPayAmount('');
      setPayDate('');
      load();
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  }

  if (error && !order) return <div className="card p-6 text-red-600">{error}</div>;
  if (!order) return <div className="p-10 text-center text-gray-400">Loading order…</div>;

  const m = order.measurements || {};
  const balance = Number(order.balance);
  // VAT is fixed on the order itself, so the total owed never moves as
  // payments come in — only the balance does.
  const vat = Number(order.vat_collected || order.vat_amount || 0);
  const discount = Number(order.discount_amount) || 0;
  const total = Number(order.price) - discount + vat;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => router.push('/orders')} className="text-sm text-gray-400 hover:text-gray-600">← All orders</button>
          <h1 className="text-2xl font-extrabold flex items-center gap-3">
            {order.order_no} <StatusBadge status={order.status} /> <PayBadge status={order.payment_status} />
          </h1>
          <p className="text-sm text-gray-500">
            Created {fmtDate(order.created_at)} by {order.created_by_name || '—'}
            {order.tailor_name && <> · Tailor: <b className="text-brand-700">✂️ {order.tailor_name}</b></>}
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <button onClick={openEdit} className="btn-outline">✏️ Edit Order</button>}
          {isAdmin && (
            <button onClick={deleteOrder} disabled={busy}
                    className="btn-outline border-red-300 text-red-600 hover:bg-red-50">
              🗑 Delete Order
            </button>
          )}
          <Link href={`/print/${order.id}`} className="btn-primary">🖨️ Print Receipt</Link>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-5">
          <h2 className="font-bold mb-2">👤 Customer</h2>
          <p className="font-semibold">{order.customer_name}</p>
          {/* Phone goes to every role that can open an order — staff need to
              call about fittings and pickups. Email and address stay admin-only. */}
          {order.customer_phone
            ? <a href={`tel:${order.customer_phone}`} className="text-sm text-brand-600 hover:underline font-medium">
                📞 {order.customer_phone}
              </a>
            : <p className="text-sm text-gray-400">No phone on file</p>}
          {isAdmin && (order.customer_email || order.customer_address) && (
            <p className="text-xs text-gray-500 mt-1">
              {[order.customer_email, order.customer_address].filter(Boolean).join(' · ')}
            </p>
          )}
          {order.branch_name && (
            <p className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
              Taken at <b className="text-brand-700">{order.branch_name}</b>
            </p>
          )}
        </div>
        <div className="card p-5">
          <h2 className="font-bold mb-2">📅 {T.appointment}</h2>
          <p className="text-lg font-extrabold">{fmtDate(order.delivery_date)}</p>
          <p className="text-xs text-gray-400">Customer collection date</p>
          {order.notes && <p className="text-sm mt-2">📝 {order.notes}</p>}
        </div>
        <div className="card p-5">
          <h2 className="font-bold mb-2">💵 Payment</h2>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span>Items total</span><b>{money(order.price)}</b></div>
            {discount > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>{T.discount}{order.discount_reason ? ` — ${order.discount_reason}` : ''}</span>
                <b>−{money(discount)}</b>
              </div>
            )}
            {vat > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>VAT (5%) · {paymentMethodLabel(order.vat_method)}</span><b>{money(vat)}</b>
              </div>
            )}
            <div className="flex justify-between border-t pt-1"><span>Total</span><b>{money(total)}</b></div>
            <div className="flex justify-between text-green-700"><span>Paid</span><b>{money(order.paid)}</b></div>
            <div className="flex justify-between border-t pt-1 text-base">
              <span>Balance</span><b className={balance > 0 ? 'text-red-600' : 'text-green-600'}>{money(order.balance)}</b>
            </div>
          </div>
        </div>
      </div>

      {/* Status control */}
      <div className="card p-5">
        <h2 className="font-bold mb-3">Order Status</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS_LABELS).map(([v, l]) => {
            if (v === 'cancelled' && !isAdmin) return null;
            return (
              <button key={v} disabled={busy || order.status === v || order.status === 'cancelled'}
                onClick={() => changeStatus(v)}
                className={`btn text-sm ${order.status === v
                  ? 'bg-brand-600 text-white'
                  : v === 'cancelled' ? 'border border-red-300 text-red-600 hover:bg-red-50'
                  : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                {l}
              </button>
            );
          })}
        </div>
        {order.status === 'delivered' && order.payment_status === 'paid' && !isAdmin && (
          <p className="text-xs text-amber-600 mt-2">This order is delivered &amp; fully paid — it will disappear from your list and remain visible to the admin only.</p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Items */}
        <div className="card p-5">
          <h2 className="font-bold mb-3">🧵 Items</h2>
          {order.items.map((it) => {
            // Each of the three kinds of line reads differently, and a line
            // labelled by the wrong one is confusing rather than merely ugly.
            const kind = it.line_type || 'tailoring';
            const cloth = Number(it.fabric_amount) || 0;
            const sewing = (Number(it.unit_price) || 0) * (Number(it.qty) || 1);
            return (
              <div key={it.id} className="flex justify-between items-start py-2 border-b last:border-0 text-sm">
                <div>
                  {kind === 'product' && (
                    <>
                      <p className="font-semibold">
                        {it.qty} × {it.product_name}
                        <span className="chip-blue ml-2 !text-[10px]">{T.lineProduct}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {[it.variant_size, it.variant_color, it.product_brand].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </>
                  )}
                  {kind === 'fabric' && (
                    <>
                      <p className="font-semibold">
                        {Number(it.meters)} yd — {it.fabric_code}
                        <span className="chip-green ml-2 !text-[10px]">{T.lineFabric}</span>
                      </p>
                      <p className="text-xs text-gray-500">{it.fabric_name} {it.fabric_color || ''}</p>
                    </>
                  )}
                  {kind === 'tailoring' && (
                    <>
                      <p className="font-semibold">{it.qty} × {garmentLabel(it.garment_type)}</p>
                      <p className="text-xs text-gray-500">
                        {it.fabric_code ? `${it.fabric_code} · ${it.fabric_name} ${it.fabric_color || ''}` : 'Customer’s own fabric'}
                        {Number(it.meters) > 0 && ` · ${Number(it.meters)} yd`}
                      </p>
                      {(cloth > 0 || sewing > 0) && (
                        <p className="text-[11px] text-slate-400">
                          {cloth > 0 && `maro ${money(cloth)}`}
                          {cloth > 0 && sewing > 0 && ' + '}
                          {sewing > 0 && `${T.sewingCharge.toLowerCase()} ${money(sewing)}`}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <b>{money(it.amount)}</b>
              </div>
            );
          })}
        </div>

        {/* Payments */}
        <div className="card p-5">
          <h2 className="font-bold mb-3">💳 Payment History</h2>
          {order.payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-2 border-b text-sm">
              <div>
                <p className="font-semibold text-green-700">{money(p.amount)} <span className="text-gray-400 font-normal uppercase text-xs">{paymentMethodLabel(p.method)}</span>
                </p>
                <p className="text-xs text-gray-400">{fmtDate(p.created_at)} · {p.received_by_name || ''} {p.note ? `· ${p.note}` : ''}</p>
              </div>
              {isAdmin && order.status !== 'cancelled' && (
                <button onClick={() => deletePayment(p)} disabled={busy}
                        className="text-xs font-bold text-rose-500 hover:text-rose-700 px-2 py-1"
                        title="Delete this payment entry">
                  ✕
                </button>
              )}
            </div>
          ))}
          {!order.payments.length && <p className="text-sm text-gray-400">No payments recorded yet.</p>}

          {balance > 0 && order.status !== 'cancelled' && (
            <form onSubmit={addPayment} className="flex flex-wrap gap-2 mt-4">
              <input className="input" type="number" step="0.01" min="0.01" max={balance} required
                     placeholder={`Up to ${money(balance)}`} value={payAmount}
                     onChange={(e) => setPayAmount(e.target.value)} />
              <select className="input max-w-[150px]" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <input className="input max-w-[150px]" type="date" value={payDate}
                     onChange={(e) => setPayDate(e.target.value)} title="Leave blank to use today" />
              <button className="btn-primary whitespace-nowrap" disabled={busy}>+ Receive</button>
            </form>
          )}
          {balance > 0 && vat > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              This order already includes {money(vat)} VAT in its {money(total)} total. Payments
              do not add any further tax, whatever method is used.
            </p>
          )}
          {balance <= 0 && <p className="text-sm font-bold text-green-600 mt-3">✅ {T.fullyPaid}</p>}
        </div>
      </div>

      {/* Admin FULL edit modal — customer, order, measurements */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={saveEdit} className="card p-6 w-full max-w-2xl max-h-[88vh] overflow-y-auto space-y-5">
            <h2 className="font-bold text-lg text-slate-800">✏️ Edit Order {order.order_no}</h2>

            {/* Customer info */}
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-600 border-b border-slate-100 pb-1.5 mb-3">Customer Info</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Name *</label>
                  <input className="input" required value={editForm.customer_name}
                         onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={editForm.customer_phone}
                         onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Order + payment info */}
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-600 border-b border-slate-100 pb-1.5 mb-3">Order &amp; Payment</p>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="label">Price ($) *</label>
                  <input className="input" type="number" step="0.01" min="0.01" required
                         value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} />
                </div>
                <div>
                  <label className="label">Billed as (sets VAT)</label>
                  <select className="input" value={editForm.vat_method}
                          onChange={(e) => setEditForm({ ...editForm, vat_method: e.target.value })}>
                    {PAYMENT_METHODS.map((mm) => <option key={mm.value} value={mm.value}>{mm.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Delivery date</label>
                  <input className="input" type="date" value={editForm.delivery_date}
                         onChange={(e) => setEditForm({ ...editForm, delivery_date: e.target.value })} />
                </div>
                <div>
                  <label className="label">Notes</label>
                  <input className="input" value={editForm.notes}
                         onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                VAT is 5% of the price on every method except Cash, and is recalculated whenever
                you change the price or the method here. Balance and payment status follow automatically.
                To fix a wrong payment, delete it in Payment History below.
              </p>
            </div>

            {/* Measurements */}
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-600 border-b border-slate-100 pb-1.5 mb-3">Body Measurements — Trouser / Shalwar</p>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                {TROUSER_FIELDS.map(([k, l]) => (
                  <div key={k}>
                    <label className="label">{l}</label>
                    <input className="input" value={editForm.trouser[k] || ''}
                           onChange={(e) => setEditForm({ ...editForm, trouser: { ...editForm.trouser, [k]: e.target.value } })} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-600 border-b border-slate-100 pb-1.5 mb-3 mt-4">Coat / Kameez</p>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                {COAT_FIELDS.map(([k, l]) => (
                  <div key={k}>
                    <label className="label">{l}</label>
                    <input className="input" value={editForm.coat[k] || ''}
                           onChange={(e) => setEditForm({ ...editForm, coat: { ...editForm.coat, [k]: e.target.value } })} />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 sticky bottom-0 bg-white pt-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setEditing(false)}>{T.cancel}</button>
              <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : 'Save All Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Measurements */}
      <div className="card p-5">
        <h2 className="font-bold mb-3">📏 Measurements</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs uppercase font-bold text-brand-700 tracking-wide mb-2">Trouser / Shalwar</h3>
            <div className="grid grid-cols-2 gap-y-1 text-sm">
              {TROUSER_FIELDS.map(([k, l]) => (
                <div key={k} className="flex justify-between pr-4 border-b border-dotted py-1">
                  <span className="text-gray-500">{l}</span><b>{m.trouser?.[k] || '—'}</b>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs uppercase font-bold text-brand-700 tracking-wide mb-2">Coat / Kameez</h3>
            <div className="grid grid-cols-2 gap-y-1 text-sm">
              {COAT_FIELDS.map(([k, l]) => (
                <div key={k} className="flex justify-between pr-4 border-b border-dotted py-1">
                  <span className="text-gray-500">{l}</span><b>{m.coat?.[k] || '—'}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
