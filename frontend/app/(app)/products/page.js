'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, money, getUser } from '@/lib/api';
import Pagination, { usePagination } from '@/components/Pagination';
import { T } from '@/lib/labels';

// A product with no sizes cannot be sold, so the form always starts with one
// empty row rather than letting someone save a product nobody can buy.
const emptyVariant = () => ({ size: '', color: '', cost_price: '', sell_price: '', quantity: '', reorder_level: 3 });
const EMPTY = { name: '', brand: '', category_id: '', description: '', branch_id: '', variants: [emptyVariant()] };

const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];
const COMMON_COLORS = ['Black', 'White', 'Navy', 'Blue', 'Grey', 'Brown', 'Beige', 'Cream',
                       'Green', 'Maroon', 'Red', 'Gold', 'Silver', 'Pink', 'Purple'];

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [stockFor, setStockFor] = useState(null);  // variant being restocked
  const [stockQty, setStockQty] = useState('');
  const [editVar, setEditVar] = useState(null);    // variant being repriced
  const [expanded, setExpanded] = useState({});    // product id -> show variants
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const user = typeof window !== 'undefined' ? getUser() : null;
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const isSuper = user?.role === 'superadmin';
  const { paged, controls } = usePagination(products, [search, lowOnly]);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (lowOnly) q.set('low', '1');
    api(`/products?${q}`).then((d) => setProducts(d || [])).catch((e) => setError(e.message));
  }, [search, lowOnly]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api('/products/categories').then(setCategories).catch(() => {});
    if (isSuper) api('/branches').then((d) => setBranches((d || []).filter((b) => b.active))).catch(() => {});
  }, [isSuper]);

  const category = categories.find((c) => String(c.id) === String(form.category_id));

  function setVariant(i, patch) {
    setForm((f) => ({ ...f, variants: f.variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)) }));
  }

  async function addProduct(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (isSuper && !form.branch_id) throw new Error('Choose which branch this product belongs to');
      const body = {
        ...form,
        category_id: form.category_id || null,
        branch_id: isSuper ? Number(form.branch_id) : undefined,
        variants: form.variants
          // A row where nothing was typed is someone tabbing past, not an
          // item — drop it rather than saving a blank size.
          .filter((v) => v.size || v.color || v.quantity || v.sell_price)
          .map((v) => ({
            ...v,
            cost_price: Number(v.cost_price) || 0,
            sell_price: Number(v.sell_price) || 0,
            quantity: Number(v.quantity) || 0,
            reorder_level: Number(v.reorder_level) || 3,
          })),
      };
      if (!body.variants.length) throw new Error('Add at least one size or colour — that is what actually gets sold');
      await api('/products', { method: 'POST', body: JSON.stringify(body) });
      setShowAdd(false); setForm(EMPTY); load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function addStock(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api(`/products/variants/${stockFor.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({ qty: Number(stockQty), type: 'in', note: 'New delivery' }),
      });
      setStockFor(null); setStockQty(''); load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function saveVariant(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api(`/products/variants/${editVar.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          size: editVar.size, color: editVar.color,
          cost_price: Number(editVar.cost_price) || 0,
          sell_price: Number(editVar.sell_price) || 0,
          reorder_level: Number(editVar.reorder_level) || 3,
        }),
      });
      setEditVar(null); load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  const lowCount = products.reduce(
    (n, p) => n + (p.variants || []).filter((v) => Number(v.quantity) <= Number(v.reorder_level)).length, 0);

  return (
    <div className="space-y-5">
      <datalist id="sizes">{COMMON_SIZES.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="colors">{COMMON_COLORS.map((c) => <option key={c} value={c} />)}</datalist>

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="text-sm text-slate-500">Alaab diyaar ah — stock is counted per size and colour.</p>
        {isAdmin && (
          <button className="btn-primary" onClick={() => { setShowAdd(!showAdd); setError(''); }}>
            {showAdd ? 'Close' : `+ ${T.newProduct}`}
          </button>
        )}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      {/* ---------- Add product ---------- */}
      {showAdd && (
        <form onSubmit={addProduct} className="card p-6 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {isSuper && (
              <div className="col-span-2 md:col-span-4">
                <label className="label">Branch *</label>
                <select className="input" required value={form.branch_id}
                        onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                  <option value="">Choose a branch…</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                </select>
              </div>
            )}
            <div><label className="label">Name *</label>
              <input className="input" required value={form.name}
                     onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cabaayad Dubai" /></div>
            <div><label className="label">Brand</label>
              <input className="input" value={form.brand}
                     onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="Al Karam" /></div>
            <div><label className="label">Nooca</label>
              <select className="input" value={form.category_id}
                      onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="label">Description</label>
              <input className="input" value={form.description}
                     onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>

          {/* Variants — the actual sellable things */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-bold text-slate-700 text-sm">Sizes &amp; colours</p>
              </div>
              <button type="button" className="btn-outline text-xs py-1.5"
                      onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, emptyVariant()] }))}>
                + Add row
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-1">{T.size}</th><th className="pb-1">{T.colour}</th>
                  {category?.attribute_schema?.map((a) => <th key={a.key} className="pb-1">{a.label}</th>)}
                  <th className="pb-1 text-right">Cost</th><th className="pb-1 text-right">Price</th>
                  <th className="pb-1 text-right">Qty</th><th className="pb-1 text-right">Alert at</th>
                  <th className="pb-1 text-right">Margin</th><th></th>
                </tr></thead>
                <tbody>
                  {form.variants.map((v, i) => {
                    const c = Number(v.cost_price) || 0;
                    const s = Number(v.sell_price) || 0;
                    const m = s - c;
                    return (
                      <tr key={i}>
                        <td className="pr-1.5 py-1"><input className="input !py-1.5" list="sizes" value={v.size}
                               onChange={(e) => setVariant(i, { size: e.target.value })} placeholder="M" /></td>
                        <td className="pr-1.5"><input className="input !py-1.5" list="colors" value={v.color}
                               onChange={(e) => setVariant(i, { color: e.target.value })} placeholder="Black" /></td>
                        {category?.attribute_schema?.map((a) => (
                          <td key={a.key} className="pr-1.5">
                            <input className="input !py-1.5" value={v.attributes?.[a.key] || ''}
                                   onChange={(e) => setVariant(i, { attributes: { ...(v.attributes || {}), [a.key]: e.target.value } })} />
                          </td>
                        ))}
                        <td className="pr-1.5"><input className="input !py-1.5 text-right" type="number" step="0.01" min="0"
                               value={v.cost_price} onChange={(e) => setVariant(i, { cost_price: e.target.value })} /></td>
                        <td className="pr-1.5"><input className="input !py-1.5 text-right" type="number" step="0.01" min="0"
                               value={v.sell_price} onChange={(e) => setVariant(i, { sell_price: e.target.value })} /></td>
                        <td className="pr-1.5"><input className="input !py-1.5 text-right" type="number" min="0"
                               value={v.quantity} onChange={(e) => setVariant(i, { quantity: e.target.value })} /></td>
                        <td className="pr-1.5"><input className="input !py-1.5 text-right" type="number" min="0"
                               value={v.reorder_level} onChange={(e) => setVariant(i, { reorder_level: e.target.value })} /></td>
                        <td className={`pr-1.5 text-right tabular-nums font-semibold ${
                          m < 0 ? 'text-rose-600' : m > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                          {c > 0 || s > 0 ? money(m) : '—'}
                        </td>
                        <td className="text-right">
                          {form.variants.length > 1 && (
                            <button type="button" className="text-rose-500 font-bold px-2"
                                    onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((_, x) => x !== i) }))}>×</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {form.variants.some((v) => Number(v.sell_price) > 0 && Number(v.sell_price) < Number(v.cost_price)) && (
              <p className="text-xs font-semibold text-rose-600 mt-2">
                ⚠️ One of these sells for less than it cost.
              </p>
            )}
          </div>

          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : T.newProduct}</button>
        </form>
      )}

      {/* ---------- Filters ---------- */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <input className="input max-w-sm" placeholder="Search by name, brand, size or colour…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-500 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={lowOnly}
                 onChange={(e) => setLowOnly(e.target.checked)} />
          Running low only
        </label>
        {lowCount > 0 && !lowOnly && (
          <span className="text-xs font-bold text-amber-600">{lowCount} item(s) running low</span>
        )}
      </div>

      {/* ---------- List ---------- */}
      <div className="card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="border-b bg-gray-50">
            <th className="th">Name</th>
            <th className="th">Nooca</th>
            {isSuper && <th className="th">Branch</th>}
            <th className="th text-right">Sizes</th>
            <th className="th text-right">{T.inStock}</th>
            <th className="th text-right">Price range</th>
            <th className="th"></th>
          </tr></thead>
          <tbody>
            {paged.map((p) => {
              const vs = p.variants || [];
              const prices = vs.map((v) => Number(v.sell_price)).filter((n) => n > 0);
              const lo = prices.length ? Math.min(...prices) : 0;
              const hi = prices.length ? Math.max(...prices) : 0;
              const total = Number(p.total_stock) || 0;
              const anyLow = vs.some((v) => Number(v.quantity) <= Number(v.reorder_level));
              const open = !!expanded[p.id];
              return (
                <Fragment key={p.id}>
                  <tr className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpanded((e) => ({ ...e, [p.id]: !open }))}>
                    <td className="td font-semibold">
                      <span className="text-slate-400 mr-1.5">{open ? '▾' : '▸'}</span>
                      {p.name}
                      {p.brand && <span className="text-slate-400 font-normal"> · {p.brand}</span>}
                    </td>
                    <td className="td text-slate-500">{p.category_name || '—'}</td>
                    {isSuper && <td className="td font-mono text-xs text-brand-700">{p.branch_code}</td>}
                    <td className="td text-right tabular-nums">{vs.length}</td>
                    <td className={`td text-right tabular-nums font-bold ${
                      total === 0 ? 'text-rose-600' : anyLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {total}{anyLow && total > 0 && ' ⚠️'}{total === 0 && ' 🚫'}
                    </td>
                    <td className="td text-right tabular-nums">
                      {lo ? (lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`) : '—'}
                    </td>
                    <td className="td text-right text-[11px] text-slate-400">{open ? 'hide' : 'sizes'}</td>
                  </tr>

                  {open && vs.map((v) => {
                    const low = Number(v.quantity) <= Number(v.reorder_level);
                    return (
                      <tr key={`${p.id}-${v.id}`} className="border-b last:border-0 bg-slate-50/60">
                        <td className="td pl-8 text-slate-600">
                          {[v.size, v.color].filter(Boolean).join(' · ') || '(only one kind)'}
                        </td>
                        <td className="td text-[11px] text-slate-400" colSpan={isSuper ? 2 : 1}>
                          {Object.entries(v.attributes || {}).filter(([, x]) => x)
                            .map(([k, x]) => `${k}: ${x}`).join(' · ')}
                        </td>
                        <td className="td text-right text-[11px] text-slate-400">
                          {isAdmin && v.cost_price !== undefined && `cost ${money(v.cost_price)}`}
                        </td>
                        <td className={`td text-right tabular-nums font-bold ${
                          Number(v.quantity) === 0 ? 'text-rose-600' : low ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {v.quantity}
                        </td>
                        <td className="td text-right tabular-nums font-semibold">{money(v.sell_price)}</td>
                        <td className="td text-right whitespace-nowrap">
                          {isAdmin && (
                            <>
                              <button className="btn-outline text-xs py-1 mr-1.5"
                                      onClick={(e) => { e.stopPropagation(); setEditVar({ ...v, product_name: p.name }); setError(''); }}>✏️</button>
                              <button className="btn-outline text-xs py-1"
                                      onClick={(e) => { e.stopPropagation(); setStockFor({ ...v, product_name: p.name }); setStockQty(''); setError(''); }}>
                                + {T.addStock}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {!products.length && (
              <tr><td className="td text-gray-400" colSpan={isSuper ? 7 : 6}>No products yet.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination {...controls} />
      </div>

      {/* ---------- Receive stock ---------- */}
      {stockFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
             onClick={() => setStockFor(null)}>
          <form onSubmit={addStock} onClick={(e) => e.stopPropagation()}
                className="card p-6 w-full max-w-sm space-y-4">
            <div>
              <h2 className="font-bold text-lg text-slate-800">+ {T.addStock}</h2>
              <p className="text-sm text-slate-500">
                {stockFor.product_name} · {[stockFor.size, stockFor.color].filter(Boolean).join(' · ')}
                {' '}— now <b>{stockFor.quantity}</b>
              </p>
            </div>
            <div>
              <label className="label">How many arrived?</label>
              <input className="input text-lg font-bold" type="number" min="1" required autoFocus
                     value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setStockFor(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : T.addStock}</button>
            </div>
          </form>
        </div>
      )}

      {/* ---------- Edit a size/colour ---------- */}
      {editVar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
             onClick={() => setEditVar(null)}>
          <form onSubmit={saveVariant} onClick={(e) => e.stopPropagation()}
                className="card p-6 w-full max-w-md space-y-4">
            <h2 className="font-bold text-lg text-slate-800">✏️ {editVar.product_name}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{T.size}</label>
                <input className="input" list="sizes" value={editVar.size || ''}
                       onChange={(e) => setEditVar({ ...editVar, size: e.target.value })} /></div>
              <div><label className="label">{T.colour}</label>
                <input className="input" list="colors" value={editVar.color || ''}
                       onChange={(e) => setEditVar({ ...editVar, color: e.target.value })} /></div>
              <div><label className="label">Cost</label>
                <input className="input" type="number" step="0.01" min="0" value={editVar.cost_price ?? ''}
                       onChange={(e) => setEditVar({ ...editVar, cost_price: e.target.value })} /></div>
              <div><label className="label">Price</label>
                <input className="input" type="number" step="0.01" min="0" value={editVar.sell_price ?? ''}
                       onChange={(e) => setEditVar({ ...editVar, sell_price: e.target.value })} /></div>
              <div><label className="label">Alert when stock reaches</label>
                <input className="input" type="number" min="0" value={editVar.reorder_level ?? ''}
                       onChange={(e) => setEditVar({ ...editVar, reorder_level: e.target.value })} /></div>
            </div>
            <p className="text-[11px] text-slate-400">Stock changes only through {T.addStock} or a sale.</p>
            <div className="flex gap-2">
              <button type="button" className="btn-outline flex-1" onClick={() => setEditVar(null)}>{T.cancel}</button>
              <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
