'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getUser } from '@/lib/api';
import CameraScanner from '@/components/CameraScanner';
import Lightbox from '@/components/Lightbox';

export default function ScanPage() {
  const router = useRouter();
  const inputRef = useRef(null);
  const [code, setCode] = useState('');
  const [fabric, setFabric] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [camera, setCamera] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const user = typeof window !== 'undefined' ? getUser() : null;

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Search as you type, but wait for a pause first — firing a request on
  // every keystroke would hammer the backend and the results would flicker
  // as slower responses landed out of order.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`/fabrics?search=${encodeURIComponent(q)}`)
        .then((rows) => { if (!cancelled) setResults(rows.slice(0, 25)); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  // Picking a result shows it in the same card the scanner fills, so there's
  // one place to read stock from however the fabric was found.
  function pickResult(f) {
    setFabric(f);
    setError('');
    setSearch('');
    setResults([]);
  }

  async function lookupCode(raw) {
    const value = (raw || '').trim();
    if (!value) return;
    setLoading(true);
    setError('');
    setFabric(null);
    try {
      const f = await api(`/fabrics/code/${encodeURIComponent(value)}`);
      setFabric(f);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setCode('');
      inputRef.current?.focus();
    }
  }

  function lookup(e) {
    e?.preventDefault();
    lookupCode(code);
  }

  function onCameraScan(text) {
    setCamera(false);
    // QR labels may carry more data (CODE|name|...) — the code is the first part
    lookupCode(text.split(/[|;,]/)[0]);
  }

  const qty = fabric ? Number(fabric.quantity_yards) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <p className="text-sm text-slate-500 text-center">
        Point your barcode scanner at the fabric label — the code appears below automatically.
        No scanner? Type the code, or search by name or colour underneath.
      </p>

      <form onSubmit={lookup} className="card p-6">
        <label className="label">Fabric Code</label>
        <div className="flex gap-2">
          <input ref={inputRef} className="input text-xl tracking-widest font-mono uppercase"
                 value={code} onChange={(e) => setCode(e.target.value)}
                 placeholder="e.g. SS0098" autoComplete="off" />
          <button className="btn-primary px-6" disabled={loading}>{loading ? '…' : 'Check'}</button>
        </div>
        <button type="button" onClick={() => setCamera(true)}
                className="btn-outline w-full mt-3 !py-3">
          📷 Scan with phone / device camera
        </button>
      </form>

      {/* No scanner to hand, or only half the code is legible on the label?
          Search the catalogue by code, name or colour and pick from the list. */}
      <div className="card p-6">
        <label className="label">Or search by code, name or colour</label>
        <input className="input" value={search} autoComplete="off"
               onChange={(e) => setSearch(e.target.value)}
               placeholder="e.g. X125, navy, Ultrafine…" />

        {searching && <p className="text-sm text-slate-400 mt-3">Searching…</p>}

        {!searching && search.trim().length > 0 && search.trim().length < 2 && (
          <p className="text-sm text-slate-400 mt-3">Type at least 2 characters.</p>
        )}

        {!searching && search.trim().length >= 2 && results.length === 0 && (
          <p className="text-sm text-slate-400 mt-3">No fabric matches “{search.trim()}”.</p>
        )}

        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {results.map((f) => {
              const left = Number(f.quantity_yards);
              return (
                <li key={f.id}>
                  <button type="button" onClick={() => pickResult(f)}
                          className="w-full flex items-center gap-3 py-2.5 px-1 text-left hover:bg-slate-50 rounded-lg">
                    {f.image
                      ? <img src={f.image} alt="" className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                      : <span className="w-11 h-11 rounded-lg bg-slate-100 flex-shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs text-slate-500">{f.code}</span>
                      <span className="block font-bold text-slate-700 truncate">{f.name}</span>
                      <span className="block text-xs text-slate-400 truncate">
                        {[f.color, f.brand].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className={`text-xs font-bold whitespace-nowrap ${left > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {left > 0 ? `${left} m` : 'OUT'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {camera && <CameraScanner onScan={onCameraScan} onClose={() => setCamera(false)} />}
      {lightbox && <Lightbox src={fabric?.image} alt={fabric?.name} onClose={() => setLightbox(false)} />}

      {error && (
        <div className="card p-6 border-l-4 border-red-500">
          <p className="font-bold text-red-600">Fabric not found</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
        </div>
      )}

      {fabric && (
        <div className={`card overflow-hidden border-l-4 ${qty > 0 ? 'border-green-500' : 'border-red-500'}`}>
          {/* Fabric photo banner */}
          {fabric.image && (
            <div className="relative">
              <img src={fabric.image} alt={fabric.name} onClick={() => setLightbox(true)}
                   className="w-full h-56 object-cover cursor-zoom-in" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-5 pt-10 pb-3">
                <p className="font-mono text-xs text-white/80">{fabric.code}</p>
                <p className="text-xl font-extrabold text-white leading-tight">{fabric.name}</p>
              </div>
              <span className={`absolute top-3 right-3 px-3 py-1.5 rounded-full text-sm font-bold shadow-lg ${
                qty > 0 ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                {qty > 0 ? 'AVAILABLE' : 'OUT OF STOCK'}
              </span>
            </div>
          )}

          <div className="p-6 !pt-4">
          <div className="flex items-start justify-between">
            <div>
              {!fabric.image && <p className="font-mono text-sm text-gray-400">{fabric.code}</p>}
              {!fabric.image && <h2 className="text-xl font-extrabold">{fabric.name}</h2>}
              <p className="text-sm text-gray-500 mt-1">
                {[fabric.color, fabric.component, fabric.weight, fabric.brand].filter(Boolean).join(' · ')}
              </p>
            </div>
            {!fabric.image && (
              <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${qty > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {qty > 0 ? 'AVAILABLE' : 'OUT OF STOCK'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mt-5">
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 uppercase font-semibold">In Stock</p>
              <p className={`text-2xl font-extrabold ${qty > 0 ? 'text-green-600' : 'text-red-600'}`}>{qty} m</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 uppercase font-semibold">Low-stock level</p>
              <p className="text-2xl font-extrabold text-gray-600">{Number(fabric.reorder_level)} m</p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={() => router.push(`/orders/new?fabric=${fabric.code}`)}
                    className="btn-primary flex-1 py-3" disabled={qty <= 0}>
              🧾 Create Order with this Fabric
            </button>
            {user?.role === 'admin' && (
              <button onClick={() => router.push(`/fabrics?search=${fabric.code}`)} className="btn-outline flex-1 py-3">
                🧵 Manage Fabric
              </button>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
