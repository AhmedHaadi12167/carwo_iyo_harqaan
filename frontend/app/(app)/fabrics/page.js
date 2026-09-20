'use client';
import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, money, getUser } from '@/lib/api';
import Pagination, { usePagination } from '@/components/Pagination';
import CameraScanner from '@/components/CameraScanner';
import Lightbox from '@/components/Lightbox';
import { compressImage } from '@/lib/image';
import { T } from '@/lib/labels';

const EMPTY = {
  code: '', name: '', component: '', weight: '', color: '',
  cost_per_meter: '', price_per_meter: '',
  quantity_meters: '', reorder_level: 10, image: '',
};

// Common colours, offered as a datalist so typing stays free-form. A fixed
// dropdown would be wrong here: real stock includes things like "Blue
// Pinstripe" and "Charcoal Herringbone" that no list would ever cover.
const COMMON_COLORS = [
  'Black', 'White', 'Navy', 'Blue', 'Light Blue', 'Grey', 'Light Grey',
  'Charcoal', 'Brown', 'Beige', 'Cream', 'Khaki', 'Green', 'Olive',
  'Maroon', 'Burgundy', 'Red', 'Purple', 'Gold', 'Silver',
];

function FabricsInner() {
  const params = useSearchParams();
  const [fabrics, setFabrics] = useState([]);
  const [search, setSearch] = useState(params.get('search') || '');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [stockFor, setStockFor] = useState(null); // fabric being restocked
  const [stockMeters, setStockMeters] = useState('');
  const [scanValue, setScanValue] = useState('');
  const [scanMsg, setScanMsg] = useState('');
  const [camera, setCamera] = useState(false);
  const [labelFor, setLabelFor] = useState(null); // fabric whose QR label is shown
  const [editFab, setEditFab] = useState(null);   // fabric being edited (admin)
  const qrRef = useRef(null);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null); // image src being viewed full-size
  const [branches, setBranches] = useState([]);
  const user = typeof window !== 'undefined' ? getUser() : null;
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const isSuper = user?.role === 'superadmin';
  const { paged, controls } = usePagination(fabrics, [search]);

  const load = useCallback(() => {
    api(`/fabrics${search ? `?search=${encodeURIComponent(search)}` : ''}`)
      .then((d) => setFabrics(d || [])).catch((e) => setError(e.message));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  // A superadmin stocks no shelf of their own, so they must name the branch a
  // shipment arrived at. A branch admin always stocks their own branch.
  useEffect(() => {
    if (isSuper) api('/branches').then((d) => setBranches((d || []).filter((b) => b.active))).catch(() => {});
  }, [isSuper]);

  // Draw the QR code whenever the label modal opens.
  // Payload format matches the scanner: CODE|name|component|weight
  useEffect(() => {
    if (!labelFor || !qrRef.current) return;
    // code|name|component|weight|colour — colour is appended LAST so that
    // labels printed before it existed still scan correctly (they simply have
    // one field fewer), and so scanners reading only the first fields are
    // unaffected. Never insert a new field in the middle of this.
    const payload = [
      labelFor.code, labelFor.name, labelFor.component || '', labelFor.weight || '', labelFor.color || '',
    ].join('|');
    import('qrcode').then((QRCode) => {
      QRCode.toCanvas(qrRef.current, payload, { width: 190, margin: 1 }, () => {});
    });
  }, [labelFor]);

  // Parse a scanned barcode / QR label and auto-fill the form.
  // Supported formats:
  //   SS0098                            -> code only
  //   SS0098|X125|W70P30|275G/M|Navy    -> code|name|component|weight|colour (also ; )
  //   {"code":"SS0098","name":"X125",...} -> QR with JSON
  // Labels printed before colour existed simply stop after the weight, so
  // they still scan correctly — every field is optional by position.
  function applyScan(e, scanned) {
    e?.preventDefault();
    const raw = (scanned || scanValue).trim();
    if (!raw) return;
    let patch = {};
    try {
      const j = JSON.parse(raw); // QR containing JSON
      patch = {
        code: (j.code || '').toUpperCase(), name: j.name || '', component: j.component || '',
        weight: j.weight || '', ...(j.color ? { color: j.color } : {}),
      };
    } catch {
      // code|name|component|weight|colour — keep positions, allow empties
      const parts = raw.split(/[|;]/).map((s) => s.trim());
      patch = {
        code: (parts[0] || '').toUpperCase(),
        ...(parts[1] ? { name: parts[1] } : {}),
        ...(parts[2] ? { component: parts[2] } : {}),
        ...(parts[3] ? { weight: parts[3] } : {}),
        ...(parts[4] ? { color: parts[4] } : {}),
      };
    }
    setForm((f) => ({ ...f, ...patch }));
    const filled = Object.keys(patch).filter((k) => patch[k]).length;
    setScanMsg(`✓ Label read — ${filled} field${filled > 1 ? 's' : ''} filled automatically. Check and complete the rest.`);
    setScanValue('');
  }

  // Compress a chosen/taken photo and hand it to the form
  async function pickImage(e, apply) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { apply(await compressImage(file)); } catch (err) { setError(err.message); }
  }

  async function addFabric(e) {
    e.preventDefault();
    setError('');
    try {
      if (isSuper && !form.branch_id) { setError('Choose which branch this shipment arrived at'); return; }
      const body = { ...form };
      if (isSuper) body.branch_id = Number(body.branch_id); else delete body.branch_id;
      await api('/fabrics', { method: 'POST', body: JSON.stringify(body) });
      setShowAdd(false);
      setForm(EMPTY);
      load();
    } catch (err) { setError(err.message); }
  }

  async function saveFabricEdit(e) {
    e.preventDefault();
    setError('');
    try {
      await api(`/fabrics/${editFab.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          code: editFab.code, name: editFab.name, component: editFab.component, weight: editFab.weight,
          color: editFab.color || null,
          cost_per_meter: Number(editFab.cost_per_meter) || 0,
          price_per_meter: Number(editFab.price_per_meter) || 0,
          reorder_level: Number(editFab.reorder_level) || 0,
          image: editFab.image || null,
        }),
      });
      setEditFab(null);
      load();
    } catch (err) { setError(err.message); }
  }

  async function addStock(e) {
    e.preventDefault();
    setError('');
    try {
      await api(`/fabrics/${stockFor.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({ meters: Number(stockMeters), type: 'in', note: 'New shipment' }),
      });
      setStockFor(null);
      setStockMeters('');
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-5">
      {/* Colour suggestions, shared by the add form and the edit modal.
          Declared once at the top level so both can point at the same id. */}
      <datalist id="fabric-colors">
        {COMMON_COLORS.map((c) => <option key={c} value={c} />)}
      </datalist>

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="text-sm text-slate-500">Every fabric has its own scannable code. Stock decreases automatically with orders.</p>
        {isAdmin && (
          <button className="btn-primary" onClick={() => { setShowAdd(!showAdd); setError(''); }}>
            {showAdd ? 'Close' : '+ Register New Fabric (Shipment)'}
          </button>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      {showAdd && (
        <form onSubmit={addFabric} className="card p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Scan-to-fill */}
          <div className="col-span-2 md:col-span-4 bg-brand-50 border border-brand-200 rounded-xl p-4">
            <label className="label">📷 Scan the fabric label (optional) — auto-fills the form</label>
            <div className="flex gap-2">
              <input className="input font-mono uppercase" value={scanValue}
                     onChange={(e) => setScanValue(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') applyScan(e); }}
                     placeholder="Point the scanner here and shoot…" autoFocus />
              <button type="button" className="btn-primary whitespace-nowrap" onClick={applyScan}>Read Label</button>
              <button type="button" className="btn-outline whitespace-nowrap" onClick={() => setCamera(true)}>📷 Camera</button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Simple barcodes fill the code. QR labels with more data (e.g. <span className="font-mono">SS0098|X125|W70P30|275G/M</span>)
              fill name, component and weight automatically.
            </p>
            {scanMsg && <p className="text-xs font-bold text-emerald-600 mt-1">{scanMsg}</p>}
          </div>
          {isSuper && (
            <div className="col-span-2 md:col-span-4">
              <label className="label">Branch * — which shop did this shipment arrive at?</label>
              <select className="input" required value={form.branch_id || ''}
                      onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">Choose a branch…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Each branch keeps its own stock, cost and price, so the same code can exist
                at more than one branch as separate rolls.
              </p>
            </div>
          )}
          <div><label className="label">Code *</label>
            <input className="input font-mono uppercase" required value={form.code}
                   onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SS0098" /></div>
          <div><label className="label">Name *</label>
            <input className="input" required value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="X125" /></div>
          <div><label className="label">Colour</label>
            <input className="input" list="fabric-colors" value={form.color}
                   onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="Navy" />
            <p className="text-[10px] text-slate-400 mt-0.5">Customers ask for fabric by colour more than by code.</p></div>
          <div><label className="label">Component</label>
            <input className="input" value={form.component}
                   onChange={(e) => setForm({ ...form, component: e.target.value })} placeholder="W70P30" /></div>
          <div><label className="label">Weight</label>
            <input className="input" value={form.weight}
                   onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="275G/M" /></div>
          <div><label className="label">Cost / yard *</label>
            <input className="input" type="number" step="0.01" min="0" required value={form.cost_per_meter}
                   onChange={(e) => setForm({ ...form, cost_per_meter: e.target.value })} placeholder="8.00" />
            <p className="text-[10px] text-slate-400 mt-0.5">What you paid. Staff never see this.</p></div>
          <div><label className="label">Price / yard *</label>
            <input className="input" type="number" step="0.01" min="0" required value={form.price_per_meter}
                   onChange={(e) => setForm({ ...form, price_per_meter: e.target.value })} placeholder="15.00" />
            <p className="text-[10px] text-slate-400 mt-0.5">What you sell at. Staff can see this.</p></div>
          <div><label className="label">Yards received *</label>
            <input className="input" type="number" step="0.01" min="0" required value={form.quantity_meters}
                   onChange={(e) => setForm({ ...form, quantity_meters: e.target.value })} /></div>
          <div><label className="label">Low-stock alert (yd)</label>
            <input className="input" type="number" step="0.01" min="0" value={form.reorder_level}
                   onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></div>

          {/* Live margin readout — catches a mistyped price before it is saved */}
          {Number(form.cost_per_meter) > 0 && Number(form.price_per_meter) > 0 && (
            <div className="col-span-2 md:col-span-4 -mt-1">
              {(() => {
                const c = Number(form.cost_per_meter);
                const p = Number(form.price_per_meter);
                const marginPct = Math.round(((p - c) / p) * 1000) / 10;
                const loss = p < c;
                return (
                  <p className={`text-xs font-semibold ${loss ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {loss
                      ? `⚠️ Selling below cost — you would lose ${money(c - p)} per yard.`
                      : `Margin ${money(p - c)} per yard (${marginPct}%). ${money((p - c) * (Number(form.quantity_meters) || 0))} on this shipment.`}
                  </p>
                );
              })()}
            </div>
          )}

          {/* Fabric photo */}
          <div className="col-span-2 md:col-span-4">
            <label className="label">📸 Fabric photo — customers recognize fabric by sight</label>
            <div className="flex items-center gap-3">
              {form.image ? (
                <img src={form.image} alt="fabric" onClick={() => setLightbox(form.image)}
                     className="w-20 h-20 rounded-xl object-cover border border-slate-200 cursor-zoom-in" />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-2xl">🧵</div>
              )}
              <label className="btn-outline cursor-pointer">
                {form.image ? 'Change photo' : 'Take / choose photo'}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                       onChange={(e) => pickImage(e, (img) => setForm((f) => ({ ...f, image: img })))} />
              </label>
              {form.image && (
                <button type="button" className="text-xs font-bold text-rose-500"
                        onClick={() => setForm((f) => ({ ...f, image: '' }))}>Remove</button>
              )}
            </div>
          </div>

          <div className="col-span-2 flex items-end">
            <button className="btn-primary w-full">Save Fabric</button>
          </div>
        </form>
      )}

      <div className="card p-4">
        <input className="input max-w-sm" placeholder="Search by code, name or colour…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b bg-gray-50">
            <th className="th">Code</th><th className="th">Name</th>
            {isSuper && <th className="th">Branch</th>}
            <th className="th">Colour</th>
            <th className="th">Details</th>
            {isAdmin && <th className="th text-right">Cost/yd</th>}
            <th className="th text-right">Price/yd</th>
            {isAdmin && <th className="th text-right">Margin</th>}
            <th className="th text-right">In Stock</th>
            {isAdmin && <th className="th text-right">Actions</th>}
          </tr></thead>
          <tbody>
            {paged.map((f) => {
              const qty = Number(f.quantity_meters);
              const low = qty <= Number(f.reorder_level);
              return (
                <tr key={f.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="td">
                    <span className="flex items-center gap-2.5">
                      {f.image ? (
                        <img src={f.image} alt={f.name} onClick={() => setLightbox(f.image)}
                             className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0 cursor-zoom-in" />
                      ) : (
                        <span className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">🧵</span>
                      )}
                      <span className="font-mono font-semibold">{f.code}</span>
                    </span>
                  </td>
                  <td className="td font-semibold">{f.name}</td>
                  {isSuper && (
                    <td className="td text-slate-500">
                      <span className="font-mono text-xs font-semibold text-brand-700">{f.branch_code}</span>
                    </td>
                  )}
                  <td className="td">
                    {f.color
                      ? <span className="text-slate-700">{f.color}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-gray-500">{[f.component, f.weight].filter(Boolean).join(' · ')}</td>
                  {isAdmin && (
                    <td className="td text-right text-slate-500 tabular-nums">{money(f.cost_per_meter)}</td>
                  )}
                  <td className="td text-right font-semibold tabular-nums">{money(f.price_per_meter)}</td>
                  {isAdmin && (() => {
                    const c = Number(f.cost_per_meter) || 0;
                    const p = Number(f.price_per_meter) || 0;
                    const m = p - c;
                    const pctTxt = p > 0 ? ` (${Math.round((m / p) * 100)}%)` : '';
                    return (
                      <td className={`td text-right tabular-nums font-semibold ${
                        m < 0 ? 'text-rose-600' : m === 0 ? 'text-slate-400' : 'text-emerald-600'}`}>
                        {p > 0 || c > 0 ? `${money(m)}${pctTxt}` : '—'}
                      </td>
                    );
                  })()}
                  <td className={`td text-right font-bold ${qty === 0 ? 'text-red-600' : low ? 'text-amber-600' : 'text-green-600'}`}>
                    {qty} yd {low && qty > 0 && '⚠️'}{qty === 0 && '🚫'}
                  </td>
                  {isAdmin && (
                    <td className="td text-right whitespace-nowrap">
                      <button className="btn-outline text-xs py-1.5 mr-1.5"
                              onClick={() => { setEditFab({ ...f }); setError(''); }} title="Edit fabric">✏️</button>
                      <button className="btn-outline text-xs py-1.5 mr-1.5"
                              onClick={() => setLabelFor(f)} title="Print QR label">🏷️ Label</button>
                      <button className="btn-outline text-xs py-1.5"
                              onClick={() => { setStockFor(f); setError(''); }}>+ Add Stock</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {!fabrics.length && (
              <tr><td className="td text-gray-400" colSpan={(isAdmin ? 9 : 6) + (isSuper ? 1 : 0)}>No fabrics found.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination {...controls} />
      </div>

      {camera && (
        <CameraScanner
          onScan={(text) => { setCamera(false); applyScan(null, text); }}
          onClose={() => setCamera(false)}
        />
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {/* QR label modal — the QR carries CODE|name|component|weight,
          so scanning it later auto-fills everything */}
      {labelFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-sm text-center space-y-4 max-h-[88vh] overflow-y-auto">
            {/* When printing, show ONLY the label */}
            <style>{`@media print {
              body * { visibility: hidden; }
              #fabric-label, #fabric-label * { visibility: visible; }
              #fabric-label { position: fixed; top: 0; left: 0; }
              @page { margin: 4mm; }
            }`}</style>

            <div id="fabric-label" className="inline-block bg-white border-2 border-slate-900 rounded-lg p-4 mx-auto">
              <canvas ref={qrRef} className="mx-auto" />
              <p className="font-mono font-extrabold text-lg text-black mt-2 leading-none">{labelFor.code}</p>
              <p className="text-[11px] text-black font-semibold">
                {labelFor.name}{labelFor.component ? ` · ${labelFor.component}` : ''}{labelFor.weight ? ` · ${labelFor.weight}` : ''}
              </p>
            </div>

            <p className="text-xs text-slate-400">
              Print and stick on the fabric roll. Scanning this QR fills the code, name,
              component and weight automatically.
            </p>
            <div className="flex gap-2">
              <button className="btn-outline flex-1" onClick={() => setLabelFor(null)}>Close</button>
              <button className="btn-primary flex-1" onClick={() => window.print()}>🖨️ Print Label</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit fabric modal (admin) */}
      {editFab && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={saveFabricEdit} className="card p-6 w-full max-w-lg space-y-4 max-h-[88vh] overflow-y-auto">
            <div>
              <h2 className="font-bold text-lg text-slate-800">✏️ Edit Fabric — {editFab.code}</h2>
              <p className="text-xs text-slate-400">Changing the code won&apos;t update labels already printed — reprint them after saving. Stock changes go through &quot;+ Add Stock&quot;.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Code *</label>
                <input className="input font-mono uppercase" required value={editFab.code || ''}
                       onChange={(e) => setEditFab({ ...editFab, code: e.target.value.toUpperCase() })} /></div>
              <div><label className="label">Name *</label>
                <input className="input" required value={editFab.name || ''}
                       onChange={(e) => setEditFab({ ...editFab, name: e.target.value })} /></div>
              <div><label className="label">Colour</label>
                <input className="input" list="fabric-colors" value={editFab.color || ''}
                       onChange={(e) => setEditFab({ ...editFab, color: e.target.value })} placeholder="Navy" /></div>
              <div><label className="label">Component</label>
                <input className="input" value={editFab.component || ''}
                       onChange={(e) => setEditFab({ ...editFab, component: e.target.value })} /></div>
              <div><label className="label">Weight</label>
                <input className="input" value={editFab.weight || ''}
                       onChange={(e) => setEditFab({ ...editFab, weight: e.target.value })} /></div>
              <div><label className="label">Low-stock alert (yd)</label>
                <input className="input" type="number" step="0.01" min="0" value={editFab.reorder_level || ''}
                       onChange={(e) => setEditFab({ ...editFab, reorder_level: e.target.value })} /></div>
              <div><label className="label">Cost / yard</label>
                <input className="input" type="number" step="0.01" min="0" value={editFab.cost_per_meter ?? ''}
                       onChange={(e) => setEditFab({ ...editFab, cost_per_meter: e.target.value })} /></div>
              <div><label className="label">Price / yard</label>
                <input className="input" type="number" step="0.01" min="0" value={editFab.price_per_meter ?? ''}
                       onChange={(e) => setEditFab({ ...editFab, price_per_meter: e.target.value })} /></div>
              {Number(editFab.cost_per_meter) > 0 && Number(editFab.price_per_meter) > 0 && (
                <div className="col-span-2">
                  {(() => {
                    const c = Number(editFab.cost_per_meter); const p = Number(editFab.price_per_meter);
                    return (
                      <p className={`text-xs font-semibold ${p < c ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {p < c
                          ? `⚠️ Selling below cost — ${money(c - p)} lost per yard.`
                          : `Margin ${money(p - c)} per yard (${Math.round(((p - c) / p) * 100)}%).`}
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Photo */}
            <div>
              <label className="label">📸 Fabric photo</label>
              <div className="flex items-center gap-3">
                {editFab.image ? (
                  <img src={editFab.image} alt="fabric" onClick={() => setLightbox(editFab.image)}
                       className="w-20 h-20 rounded-xl object-cover border border-slate-200 cursor-zoom-in" />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-2xl">🧵</div>
                )}
                <label className="btn-outline cursor-pointer">
                  {editFab.image ? 'Change photo' : 'Take / choose photo'}
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                         onChange={(e) => pickImage(e, (img) => setEditFab((f) => ({ ...f, image: img })))} />
                </label>
                {editFab.image && (
                  <button type="button" className="text-xs font-bold text-rose-500"
                          onClick={() => setEditFab((f) => ({ ...f, image: '' }))}>Remove</button>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setEditFab(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1">Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* Add-stock modal */}
      {stockFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={addStock} className="card p-6 w-full max-w-sm space-y-4 max-h-[88vh] overflow-y-auto">
            <h2 className="font-bold text-lg">New shipment — {stockFor.code}</h2>
            <p className="text-sm text-gray-500">
              Current stock: <b>{Number(stockFor.quantity_meters)} m</b>. Meters entered will be <b>added</b> on top.
            </p>
            <div>
              <label className="label">Yards received</label>
              <input className="input" type="number" step="0.01" min="0.01" autoFocus required
                     value={stockMeters} onChange={(e) => setStockMeters(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setStockFor(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1">Add to Stock</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function FabricsPage() {
  return <Suspense fallback={null}><FabricsInner /></Suspense>;
}
