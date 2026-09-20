'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, money, getUser } from '@/lib/api';
import { T } from '@/lib/labels';

const EMPTY = { name: '', code: '', phone: '', address: '' };

export default function BranchesPage() {
  const [branches, setBranches] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const user = typeof window !== 'undefined' ? getUser() : null;
  const isSuper = user?.role === 'superadmin';

  const load = useCallback(() => {
    api('/branches').then((d) => setBranches(d || [])).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addBranch(e) {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const b = await api('/branches', { method: 'POST', body: JSON.stringify(form) });
      setShowAdd(false); setForm(EMPTY);
      setNotice(`${b.name} created. Its orders will be numbered ${b.code}-1, ${b.code}-2, … Next step: add an admin for it on the Staff page.`);
      load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      await api(`/branches/${edit.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: edit.name, phone: edit.phone, address: edit.address }),
      });
      setEdit(null); load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function toggleActive(b) {
    setError(''); setNotice('');
    const closing = b.active;
    if (closing && !confirm(
      `Close ${b.name}?\n\nIts staff will no longer be able to log in, and it stops appearing as a place to take orders. All its history is kept and it can be reopened at any time.`
    )) return;
    try {
      await api(`/branches/${b.id}`, { method: 'PUT', body: JSON.stringify({ active: !b.active }) });
      setNotice(closing ? `${b.name} is closed. Its history is intact.` : `${b.name} is open again.`);
      load();
    } catch (err) { setError(err.message); }
  }

  async function remove(b) {
    setError(''); setNotice('');
    if (!confirm(`Delete ${b.name} permanently?\n\nOnly possible because it has never been used. This cannot be undone.`)) return;
    try {
      await api(`/branches/${b.id}`, { method: 'DELETE' });
      setNotice(`${b.name} deleted.`);
      load();
    } catch (err) { setError(err.message); }
  }

  if (!isSuper) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-500 text-sm">Only the superadmin manages branches.</p>
      </div>
    );
  }

  const open = branches.filter((b) => b.active).length;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="text-sm text-slate-500">
          {branches.length} branch{branches.length === 1 ? '' : 'es'} · {open} open.
          Each branch keeps its own fabrics, staff, orders and accounts.
        </p>
        <button className="btn-primary" onClick={() => { setShowAdd(!showAdd); setError(''); }}>
          {showAdd ? 'Close' : `+ ${T.newBranch}`}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">{error}</div>}
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2">{notice}</div>}

      {showAdd && (
        <form onSubmit={addBranch} className="card p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Branch name *</label>
            <input className="input" required value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Hodan" />
          </div>
          <div>
            <label className="label">Branch code *</label>
            <input className="input font-mono uppercase" required value={form.code}
                   onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                   placeholder="HDN" maxLength={8} />
            <p className="text-[11px] text-slate-500 mt-1">
              2–8 capitals/numbers. Goes into every order number from this branch
              ({form.code ? `${form.code}-1` : 'HDN-1'}), so it is <b>permanent</b> once orders exist.
            </p>
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone}
                   onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+252 61 xxxxxxx" />
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input" value={form.address}
                   onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, district, city" />
          </div>
          <div className="md:col-span-2">
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : T.newBranch}</button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="border-b bg-gray-50">
            <th className="th">Branch</th>
            <th className="th">Code</th>
            <th className="th">Contact</th>
            <th className="th text-right">Staff</th>
            <th className="th text-right">Fabrics</th>
            <th className="th text-right">Orders</th>
            <th className="th">Status</th>
            <th className="th text-right">Actions</th>
          </tr></thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id} className={`border-b last:border-0 hover:bg-gray-50 ${!b.active ? 'opacity-55' : ''}`}>
                <td className="td font-semibold">{b.name}</td>
                <td className="td"><span className="font-mono font-semibold text-brand-700">{b.code}</span></td>
                <td className="td text-slate-500">
                  {[b.phone, b.address].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="td text-right tabular-nums">{b.staff_count ?? 0}</td>
                <td className="td text-right tabular-nums">{b.fabric_count ?? 0}</td>
                <td className="td text-right tabular-nums">{b.order_count ?? 0}</td>
                <td className="td">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                    b.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {b.active ? 'Open' : 'Closed'}
                  </span>
                </td>
                <td className="td text-right whitespace-nowrap">
                  <button className="btn-outline text-xs py-1.5 mr-1.5"
                          onClick={() => { setEdit({ ...b }); setError(''); }}>✏️ Edit</button>
                  <button className="btn-outline text-xs py-1.5 mr-1.5" onClick={() => toggleActive(b)}>
                    {b.active ? 'Close' : 'Reopen'}
                  </button>
                  {/* Deleting is only offered for a branch that has never traded —
                      anything else must be closed so its history survives. */}
                  {!b.staff_count && !b.fabric_count && !b.order_count && (
                    <button className="btn-outline text-xs py-1.5 text-rose-600" onClick={() => remove(b)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
            {!branches.length && (
              <tr><td className="td text-gray-400" colSpan={8}>No branches yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
             onClick={() => setEdit(null)}>
          <form onSubmit={saveEdit} onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl p-6 w-full max-w-lg space-y-4">
            <h2 className="font-bold text-lg text-slate-800">Edit {edit.name}</h2>
            <div>
              <label className="label">Branch name</label>
              <input className="input" required value={edit.name || ''}
                     onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Code</label>
              <input className="input font-mono bg-slate-100 text-slate-500" value={edit.code || ''} disabled />
              <p className="text-[11px] text-slate-500 mt-1">
                The code cannot be changed — every order number this branch has issued
                is built from it, and editing it would orphan that history.
              </p>
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={edit.phone || ''}
                     onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={edit.address || ''}
                     onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setEdit(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
