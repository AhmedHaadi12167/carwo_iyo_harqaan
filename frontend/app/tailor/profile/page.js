'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getUser, setSession, clearSession } from '@/lib/api';
import { IconLogout } from '@/components/Icons';
import PasswordInput from '@/components/PasswordInput';

export default function TailorProfile() {
  const router = useRouter();
  const stored = typeof window !== 'undefined' ? getUser() : null;
  const [name, setName] = useState(stored?.name || '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!stored) return null;

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    if (newPw || confirmPw || currentPw) {
      if (!currentPw) return setMsg({ type: 'err', text: 'Enter your current password.' });
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
      setMsg({ type: 'ok', text: 'Profile updated.' });
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
    setBusy(false);
  }

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <div className="space-y-3">
      <div className="card p-5 flex items-center gap-4">
        <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-xl font-extrabold">
          {stored.name?.[0]?.toUpperCase()}
        </span>
        <div>
          <p className="font-extrabold text-slate-800">{stored.name}</p>
          <p className="text-xs text-slate-400">@{stored.username}{stored.phone ? ` · ${stored.phone}` : ''}</p>
          <span className="chip-green mt-1">TAILOR</span>
        </div>
      </div>

      {msg && (
        <div className={`text-sm rounded-xl px-4 py-3 border ${
          msg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={save} className="card p-5 space-y-4">
        <div>
          <label className="label">Full Name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="border-t border-slate-100 pt-4">
          <p className="font-bold text-slate-700 text-sm mb-3">Change Password</p>
          <div className="space-y-3">
            <PasswordInput placeholder="Current password"
                   value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
            <PasswordInput placeholder="New password"
                   value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <PasswordInput placeholder="Confirm new password"
                   value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
      </form>

      <button onClick={logout}
              className="btn w-full !py-3 border border-rose-200 text-rose-600 hover:bg-rose-50 bg-white">
        <IconLogout size={17} /> Sign Out
      </button>
    </div>
  );
}
