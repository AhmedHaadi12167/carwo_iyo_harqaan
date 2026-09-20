'use client';
import { useState } from 'react';
import { api, getUser, setSession } from '@/lib/api';
import PasswordInput from '@/components/PasswordInput';
import { T } from '@/lib/labels';

// Roles shown to the user. Only the three that were specified are in Somali;
// the rest keep their English names rather than being invented here.
const ROLE_TEXT = { admin: T.admin, salesman: T.salesman, tailor: T.tailors };

export default function ProfilePage() {
  const stored = typeof window !== 'undefined' ? getUser() : null;
  const [name, setName] = useState(stored?.name || '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [msg, setMsg] = useState(null); // {type, text}
  const [busy, setBusy] = useState(false);

  if (!stored) return null;

  async function save(e) {
    e.preventDefault();
    setMsg(null);

    if (newPw || confirmPw || currentPw) {
      if (!currentPw) return setMsg({ type: 'err', text: 'Enter your current password to change it.' });
      if (newPw.length < 6) return setMsg({ type: 'err', text: 'New password must be at least 6 characters.' });
      if (newPw !== confirmPw) return setMsg({ type: 'err', text: 'New passwords do not match.' });
    }

    setBusy(true);
    try {
      const body = { name };
      if (newPw) { body.current_password = currentPw; body.new_password = newPw; }
      const data = await api('/auth/profile', { method: 'PUT', body: JSON.stringify(body) });
      setSession(data.token, data.user);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setMsg({ type: 'ok', text: 'Profile updated successfully.' });
      setTimeout(() => window.location.reload(), 800); // refresh topbar name
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
    setBusy(false);
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      {/* Identity card */}
      <div className="card p-6 flex items-center gap-4">
        <span className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-2xl font-extrabold">
          {stored.name?.[0]?.toUpperCase()}
        </span>
        <div>
          <p className="text-lg font-extrabold text-slate-800">{stored.name}</p>
          <p className="text-sm text-slate-400">@{stored.username}{stored.phone ? ` · ${stored.phone}` : ''}</p>
          <span className={['admin', 'superadmin'].includes(stored.role) ? 'chip-amber mt-1' : 'chip-blue mt-1'}>
            {(ROLE_TEXT[stored.role] || stored.role).toUpperCase()}
          </span>
        </div>
      </div>

      {msg && (
        <div className={`text-sm rounded-lg px-4 py-3 border ${
          msg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={save} className="card p-6 space-y-5">
        <div>
          <p className="card-title">My Details</p>
          <p className="card-sub">Your username cannot be changed. Ask an admin if needed.</p>
        </div>
        <div>
          <label className="label">Full Name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Username</label>
          <input className="input opacity-60 cursor-not-allowed" value={stored.username} disabled />
        </div>

        <div className="border-t border-slate-100 pt-5">
          <p className="card-title">Change Password</p>
          <p className="card-sub">Leave blank to keep your current password.</p>
        </div>
        <div>
          <label className="label">Current password</label>
          <PasswordInput value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
                 autoComplete="current-password" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">New password</label>
            <PasswordInput value={newPw} onChange={(e) => setNewPw(e.target.value)}
                   autoComplete="new-password" />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <PasswordInput value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                   autoComplete="new-password" />
          </div>
        </div>

        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
