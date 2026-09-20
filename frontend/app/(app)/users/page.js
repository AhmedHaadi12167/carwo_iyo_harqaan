'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, getUser, updateStoredUser } from '@/lib/api';
import { IconEdit, IconScissors } from '@/components/Icons';
import SearchSelect from '@/components/SearchSelect';
import Pagination, { usePagination } from '@/components/Pagination';
import PasswordInput from '@/components/PasswordInput';
import { T } from '@/lib/labels';

const EMPTY = { name: '', username: '', phone: '', email: '', password: '', role: 'salesman', salary: '', branch_id: '' };

const ROLE_CHIP = { superadmin: 'chip-amber', admin: 'chip-amber', salesman: 'chip-blue', tailor: 'chip-green', master_tailor: 'chip-green', cashier: 'chip-red' };
const ROLE_LABELS = { superadmin: 'Superadmin', admin: T.admin, salesman: T.salesman, tailor: T.tailors, master_tailor: 'Master Tailor', cashier: 'Cashier' };
const ROLE_OPTIONS = [
  { value: 'salesman', label: T.salesman },
  { value: 'tailor', label: T.tailors },
  { value: 'master_tailor', label: 'Master Tailor' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'admin', label: `${T.admin} (this branch)` },
];
// Only a superadmin can create another superadmin, so the option only exists
// for them. A superadmin belongs to no branch by definition.
const SUPER_OPTION = { value: 'superadmin', label: `Superadmin (${T.allBranches})` };

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [tailorStats, setTailorStats] = useState(null); // null = not built yet
  const [perfSelection, setPerfSelection] = useState(''); // '' none, 'all', or tailor id
  const [form, setForm] = useState(EMPTY);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null); // {id, name, phone, role, active, password}
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState('');
  const [branches, setBranches] = useState([]);
  const me = typeof window !== 'undefined' ? getUser() : null;
  const isSuper = me?.role === 'superadmin';
  const roleOptions = isSuper ? [...ROLE_OPTIONS, SUPER_OPTION] : ROLE_OPTIONS;
  const { paged, controls } = usePagination(users, [showArchived]);

  // Removed staff are kept in the database (their name is on old orders and
  // payments) — they're just switched off. Tick "Show removed staff" to see
  // them again and restore anyone switched off by mistake.
  const load = useCallback(() => {
    api(`/users${showArchived ? '?archived=1' : ''}`).then(setUsers).catch((e) => setError(e.message));
  }, [showArchived]);

  // Performance report is built ONLY after a selection, like the Reports page
  function buildPerformance() {
    if (!perfSelection) return;
    const q = perfSelection === 'all' ? '' : `?tailor_id=${perfSelection}`;
    api(`/reports/tailors${q}`).then(setTailorStats).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [load]);

  // A superadmin has to say which branch a new staff member works at; a branch
  // admin has no choice to make, so the list is only fetched when it matters.
  useEffect(() => {
    if (isSuper) api('/branches').then((d) => setBranches((d || []).filter((b) => b.active))).catch(() => {});
  }, [isSuper]);

  async function addUser(e) {
    e.preventDefault();
    setError('');
    try {
      const body = { ...form };
      if (body.role === 'superadmin') {
        delete body.branch_id;               // superadmins belong to no branch
      } else if (isSuper) {
        if (!body.branch_id) { setError('Choose which branch this staff member works at'); return; }
        body.branch_id = Number(body.branch_id);
      } else {
        delete body.branch_id;               // taken from the admin's own token
      }
      await api('/users', { method: 'POST', body: JSON.stringify(body) });
      setForm(EMPTY);
      setShowAdd(false);
      load();
    } catch (err) { setError(err.message); }
  }

  async function deleteStaff() {
    if (!confirm(
      `Remove ${editing.name} from the staff list?\n\n` +
      `They will no longer be able to log in and will disappear from the list. ` +
      `Their past orders, payments and salary records stay exactly as they are, ` +
      `and you can bring them back any time with "Show removed staff".`
    )) return;
    setError('');
    try {
      await api(`/users/${editing.id}`, { method: 'DELETE' });
      setEditing(null);
      load();
    } catch (err) { setError(err.message); setEditing(null); }
  }

  // Switch a removed staff member back on, straight from the list.
  async function restoreStaff(u) {
    if (!confirm(`Restore ${u.name}? They will be able to log in again.`)) return;
    setError('');
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ active: true }) });
      load();
    } catch (err) { setError(err.message); }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError('');
    try {
      const body = { name: editing.name, username: editing.username, phone: editing.phone, email: editing.email, role: editing.role, salary: Number(editing.salary) || 0, active: editing.active };
      if (editing.password) body.password = editing.password;
      const saved = await api(`/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      // Renaming yourself: refresh the copy of your account held in this
      // browser, or the sidebar keeps showing the old username until you
      // log out. The session itself stays valid — it's keyed on your id.
      if (editing.isMe) updateStoredUser({ name: saved.name, username: saved.username });
      setEditing(null);
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm text-slate-500">Admins see everything. Salesmen cannot see delivered &amp; fully-paid orders, customer contacts, or money totals.</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-500 whitespace-nowrap cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={showArchived}
                   onChange={(e) => setShowArchived(e.target.checked)} />
            Show removed staff
          </label>
          <button className="btn-primary whitespace-nowrap" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Close' : `+ ${T.staff}`}</button>
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      {showAdd && (
        <form onSubmit={addUser} className="card p-6 grid grid-cols-2 gap-4">
          <div><label className="label">Full Name *</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Username * (login name — anything you want)</label>
            <input className="input" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. cumar99" /></div>
          <div><label className="label">Phone * (can also be used to log in)</label>
            <input className="input" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+252 61 xxx xxxx" /></div>
          <div><label className="label">Email (needed for "Forgot password")</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" /></div>
          <div><label className="label">Password *</label>
            <PasswordInput required minLength={6} value={form.password}
                   onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div><label className="label">Role *</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">A staff number (ST001, ST002…) is generated automatically for every role except Admin.</p>
          </div>
          {isSuper && (
            <div><label className="label">Branch {form.role === 'superadmin' ? '' : '*'}</label>
              <select className="input" value={form.branch_id} disabled={form.role === 'superadmin'}
                      onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">
                  {form.role === 'superadmin' ? `${T.allBranches}` : 'Choose a branch…'}
                </option>
                {form.role !== 'superadmin' && branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                {form.role === 'superadmin'
                  ? 'A superadmin oversees every branch and belongs to none.'
                  : 'They will only ever see this branch\'s orders, fabrics and money.'}
              </p>
            </div>
          )}
          <div className="col-span-2"><label className="label">Monthly salary ($) — auto-posted as an expense on the 1st of each month</label>
            <input className="input" type="number" step="0.01" min="0" value={form.salary} placeholder="0 = no automatic salary"
                   onChange={(e) => setForm({ ...form, salary: e.target.value })} /></div>
          <button className="btn-primary col-span-2">Create Account</button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-slate-100 bg-slate-50/60">
            <th className="th">Staff #</th><th className="th">Name</th><th className="th">Username</th><th className="th">Phone</th><th className="th">Email</th><th className="th">Role</th>
            {isSuper && <th className="th">Branch</th>}
            <th className="th text-right">Salary/mo</th>
            <th className="th">Since</th><th className="th">Status</th><th className="th text-right">Actions</th>
          </tr></thead>
          <tbody>
            {paged.map((u) => (
              <tr key={u.id} className={`table-row${u.active ? '' : ' opacity-60'}`}>
                <td className="td font-mono text-slate-500">{u.staff_no || '—'}</td>
                <td className="td font-bold text-slate-700">
                  {u.name}{me?.id === u.id && <span className="text-xs text-slate-400 font-normal"> (you)</span>}
                </td>
                <td className="td font-mono">{u.username}</td>
                <td className="td">{u.phone || '—'}</td>
                <td className="td text-slate-500">{u.email || '—'}</td>
                <td className="td">
                  <span className={ROLE_CHIP[u.role] || 'chip-blue'}>{(ROLE_LABELS[u.role] || u.role).toUpperCase()}</span>
                </td>
                {isSuper && (
                  <td className="td text-slate-500">
                    {u.branch_name || <span className="text-amber-600 font-semibold">{T.allBranches}</span>}
                  </td>
                )}
                <td className="td text-right font-bold">{Number(u.salary) > 0 ? `$${Number(u.salary).toLocaleString()}` : '—'}</td>
                <td className="td text-slate-400">{fmtDate(u.created_at)}</td>
                <td className="td">
                  <span className={u.active ? 'chip-green' : 'chip-red'}>{u.active ? 'ACTIVE' : 'REMOVED'}</span>
                </td>
                <td className="td text-right">
                  <div className="inline-flex gap-2">
                    {!u.active && (
                      <button className="btn-outline !px-2.5 !py-1.5 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              onClick={() => restoreStaff(u)} title="Let this staff member log in again">
                        ↩ Restore
                      </button>
                    )}
                    <button className="btn-outline !px-2.5 !py-1.5 text-xs"
                            onClick={() => setEditing({ id: u.id, name: u.name, username: u.username, phone: u.phone || '', email: u.email || '', role: u.role, salary: u.salary || 0, active: u.active, password: '', isMe: me?.id === u.id })}>
                      <IconEdit size={13} /> Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination {...controls} />
      </div>

      {/* Tailor performance — build it like a report: choose first, then display */}
      <div className="card p-5">
        <p className="card-title flex items-center gap-2"><IconScissors size={17} className="text-brand-600" /> Tailor Performance</p>
        <p className="card-sub">Choose one tailor or all of them, then build the report.</p>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div className="w-64">
            <label className="label">Tailor</label>
            <SearchSelect
              placeholder="Select a tailor…"
              value={perfSelection}
              onChange={(v) => { setPerfSelection(v); setTailorStats(null); }}
              options={[
                { value: 'all', label: 'All tailors', search: 'all' },
                ...users.filter((u) => u.role === 'tailor').map((u) => ({
                  value: u.id, label: u.name, hint: u.phone, search: `${u.name} ${u.phone || ''}`,
                })),
              ]}
            />
          </div>
          <button className="btn-primary" disabled={!perfSelection} onClick={buildPerformance}>
            Build Performance Report
          </button>
        </div>
      </div>

      {tailorStats && tailorStats.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="px-5 pt-5 pb-3">
            <p className="card-title flex items-center gap-2"><IconScissors size={17} className="text-brand-600" /> Performance Results</p>
            <p className="card-sub">Jobs each tailor was assigned and completed.</p>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">
              <th className="th">Tailor</th>
              <th className="th text-right">Total Jobs</th>
              <th className="th text-right">In Progress</th>
              <th className="th text-right">Completed</th>
              <th className="th text-right">Completion Rate</th>
              <th className="th">Last Activity</th>
            </tr></thead>
            <tbody>
              {tailorStats.map((t) => {
                const rate = t.total_jobs > 0 ? Math.round((t.completed / t.total_jobs) * 100) : 0;
                return (
                  <tr key={t.id} className="table-row">
                    <td className="td font-bold text-slate-700">
                      {t.name} <span className="text-xs text-slate-400 font-normal">@{t.username}</span>
                      {!t.active && <span className="chip-red ml-2">DISABLED</span>}
                    </td>
                    <td className="td text-right font-extrabold">{t.total_jobs}</td>
                    <td className="td text-right font-bold text-blue-500">{t.in_progress}</td>
                    <td className="td text-right font-bold text-emerald-600">{t.completed}</td>
                    <td className="td text-right">
                      <div className="inline-flex items-center gap-2">
                        <span className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden inline-block">
                          <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${rate}%` }} />
                        </span>
                        <b>{rate}%</b>
                      </div>
                    </td>
                    <td className="td text-slate-400">{t.last_claimed ? fmtDate(t.last_claimed) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit staff modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={saveEdit} className="card p-6 w-full max-w-sm space-y-4 max-h-[88vh] overflow-y-auto">
            <h2 className="font-bold text-lg text-slate-800">Edit Staff Member</h2>
            <div>
              <label className="label">Full Name</label>
              <input className="input" required value={editing.name}
                     onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Username (used to log in)</label>
              <input className="input font-mono" required minLength={3} maxLength={30}
                     value={editing.username}
                     onChange={(e) => setEditing({ ...editing, username: e.target.value })} />
              <p className="text-xs text-slate-400 mt-1">
                Letters, numbers, dot, dash or underscore — no spaces. Saved in lowercase.
                {editing.isMe && ' Changing your own username takes effect immediately; you stay logged in.'}
              </p>
            </div>
            <div>
              <label className="label">Phone (can be used to log in)</label>
              <input className="input" value={editing.phone}
                     onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">Email (needed for &quot;Forgot password&quot;)</label>
              <input className="input" type="email" value={editing.email}
                     onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={editing.role} disabled={editing.isMe}
                      onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                      data-roles={roleOptions.length}>
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              {editing.isMe && <p className="text-xs text-slate-400 mt-1">You cannot change your own role.</p>}
            </div>
            <div>
              <label className="label">Monthly salary ($)</label>
              <input className="input" type="number" step="0.01" min="0" value={editing.salary}
                     onChange={(e) => setEditing({ ...editing, salary: e.target.value })} />
              <p className="text-xs text-slate-400 mt-1">Auto-posted as a salary expense on the 1st of each month. Set 0 to stop.</p>
            </div>
            <div>
              <label className="label">Reset password (optional)</label>
              <PasswordInput minLength={6} placeholder="Leave blank to keep current"
                     value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
              <p className="text-xs text-slate-400 mt-1">
                Existing passwords can&apos;t be shown — they&apos;re stored scrambled. To get someone
                back in, type a new one here and tell them what it is.
              </p>
            </div>
            {!editing.isMe && (
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={editing.active}
                       onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                Account active (unchecked = cannot log in)
              </label>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setEditing(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1">Save</button>
            </div>
            {!editing.isMe && editing.active && (
              <button type="button" onClick={deleteStaff}
                      className="w-full text-center text-xs font-bold text-rose-600 hover:text-rose-800 pt-1">
                🗑 Remove this staff member
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
