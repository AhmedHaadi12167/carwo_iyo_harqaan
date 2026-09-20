'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, money, fmtDate, getUser } from '@/lib/api';
import { StatusBadge, PayBadge } from '@/components/Badges';
import Pagination, { usePagination } from '@/components/Pagination';
import { T } from '@/lib/labels';

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [balanceOnly, setBalanceOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null); // {id, name, phone}
  const [error, setError] = useState('');
  const user = typeof window !== 'undefined' ? getUser() : null;

  // "Balance due" filter — customers with money still owed, biggest first
  // (that's who you'd want to follow up with).
  const filtered = balanceOnly
    ? [...customers].filter((c) => Number(c.total_balance) > 0).sort((a, b) => Number(b.total_balance) - Number(a.total_balance))
    : customers;
  const dueCount = customers.filter((c) => Number(c.total_balance) > 0).length;
  const dueTotal = customers.reduce((s, c) => s + Number(c.total_balance), 0);

  const { paged, controls } = usePagination(filtered, [search, balanceOnly]);

  useEffect(() => {
    if (user && !['admin', 'superadmin'].includes(user.role)) router.replace('/dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    api(`/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`)
      .then(setCustomers).catch((e) => setError(e.message));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function openProfile(id) {
    try { setSelected(await api(`/customers/${id}`)); } catch (e) { setError(e.message); }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError('');
    try {
      await api(`/customers/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editing.name, phone: editing.phone }),
      });
      setEditing(null);
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        <span className="chip-amber mr-2">Admin only</span>
        Contact details are private and never shown to salesmen.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <input className="input max-w-sm" placeholder="Search by name or phone…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" onClick={() => setBalanceOnly(!balanceOnly)}
                className={`chip cursor-pointer select-none transition ${
                  balanceOnly ? 'chip-red' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          💰 Balance due only {dueCount > 0 && `(${dueCount})`}
        </button>
        {balanceOnly && (
          <span className="text-xs text-slate-500 ml-auto">
            <b className="text-red-600">{dueCount}</b> customer{dueCount === 1 ? '' : 's'} owe a total of <b className="text-red-600">{money(dueTotal)}</b>
          </span>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b bg-gray-50">
            <th className="th">Name</th><th className="th">Phone</th>
            <th className="th text-right">Orders</th><th className="th text-right">Balance Due</th>
            <th className="th">Since</th><th className="th text-right">Actions</th>
          </tr></thead>
          <tbody>
            {paged.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="td font-semibold text-brand-700 cursor-pointer" onClick={() => openProfile(c.id)}>{c.name}</td>
                <td className="td">{c.phone || '—'}</td>
                <td className="td text-right font-bold">{c.orders_count}</td>
                <td className={`td text-right font-bold ${Number(c.total_balance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {money(c.total_balance)}
                </td>
                <td className="td text-gray-400">{fmtDate(c.created_at)}</td>
                <td className="td text-right whitespace-nowrap">
                  <button className="btn-outline text-xs py-1 mr-2"
                          onClick={() => setEditing({ id: c.id, name: c.name, phone: c.phone || '' })}>✏️ Edit</button>
                  <Link href={`/statement/${c.id}`} className="btn-primary text-xs py-1">📄 Statement</Link>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td className="td text-gray-400" colSpan={6}>
                {balanceOnly ? 'No customers currently owe a balance. 🎉' : 'No customers yet.'}
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination {...controls} />
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={saveEdit} className="card p-6 w-full max-w-sm space-y-4 max-h-[88vh] overflow-y-auto">
            <h2 className="font-bold text-lg">✏️ Edit Customer</h2>
            <div>
              <label className="label">Name</label>
              <input className="input" required value={editing.name}
                     onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={editing.phone}
                     onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setEditing(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1">Save</button>
            </div>
          </form>
        </div>
      )}

      {/* Profile modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="card p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-extrabold">{selected.name}</h2>
                <p className="text-sm text-gray-500">{selected.phone || 'No phone'}</p>
              </div>
              <button className="text-gray-400 hover:text-gray-600" onClick={() => setSelected(null)}>✕</button>
            </div>
            <Link href={`/statement/${selected.id}`} className="btn-primary text-xs mt-3 inline-flex">📄 Full Statement (A4 / PDF)</Link>
            <h3 className="font-bold mt-4 mb-2">Order History</h3>
            <div className="space-y-2">
              {selected.orders.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="flex justify-between items-center p-3 rounded-xl border hover:bg-gray-50">
                  <div>
                    <p className="font-semibold text-brand-700">{o.order_no}</p>
                    <p className="text-xs text-gray-400">{fmtDate(o.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={o.status} />
                    <PayBadge status={o.payment_status} />
                    <b>{money(o.price)}</b>
                  </div>
                </Link>
              ))}
              {!selected.orders.length && <p className="text-sm text-gray-400">No orders yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
