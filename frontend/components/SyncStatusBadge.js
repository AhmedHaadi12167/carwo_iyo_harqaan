'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Shown only on the POS deployment (the cloud site has nothing to sync to,
// so the backend reports enabled:false there and this renders nothing).
export default function SyncStatusBadge() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const s = await api('/sync/status');
        if (!stop) setStatus(s);
      } catch { /* ignore — badge just won't update this tick */ }
    }
    poll();
    const id = setInterval(poll, 15000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  if (!status || !status.enabled) return null;

  const secsAgo = status.lastSyncedAt ? Math.floor((Date.now() - new Date(status.lastSyncedAt).getTime()) / 1000) : null;
  const timeLabel = status.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null;

  let dot = 'bg-slate-400';
  let text = 'Connecting…';
  if (secsAgo !== null && secsAgo < 90 && !status.lastError) {
    dot = 'bg-emerald-500';
    text = `Synced ${secsAgo < 5 ? 'just now' : secsAgo + 's ago'}`;
  } else if (status.lastSyncedAt) {
    dot = 'bg-amber-500';
    text = `Offline — last synced ${timeLabel}`;
  } else if (status.lastError) {
    dot = 'bg-rose-500';
    text = 'Not synced yet — check internet';
  }

  return (
    <span title="Cloud sync status" className="hidden md:flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500 shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
