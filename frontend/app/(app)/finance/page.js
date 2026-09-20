'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, money, fmtDate, getUser } from '@/lib/api';
import { elementToPdf } from '@/lib/pdf';
import { BRAND } from '@/lib/labels';

const TABS = [
  { key: 'pnl', label: '📊 Profit & Loss' },
  { key: 'balance', label: '⚖️ Balance Sheet' },
  { key: 'expenses', label: '💸 Expenses' },
  { key: 'recurring', label: '🔁 Monthly Fixed' },
  { key: 'capital', label: '🏦 Capital' },
  { key: 'assets', label: '🏭 Assets' },
];

const RECURRING_CATS = ['rent', 'utilities', 'tax', 'other'];

const EXPENSE_CATS = ['salary', 'rent', 'tax', 'utilities', 'supplies', 'marketing', 'other'];
const ASSET_CATS = ['equipment', 'furniture', 'vehicle', 'electronics', 'other'];

const firstOfMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 2).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

function Letterhead({ title, sub }) {
  return (
    <div className="flex items-start justify-between border-b-4 border-brand-700 pb-3 mb-4">
      <div>
        <p className="font-script font-semibold tracking-tight text-4xl text-brand-700 leading-none">{BRAND}</p>
        <p className="text-[10px] mt-2 tracking-[0.2em] uppercase">Management System</p>
      </div>
      <div className="text-right">
        <p className="text-lg font-extrabold tracking-[0.2em]">{title}</p>
        <p className="text-xs">{sub}</p>
      </div>
    </div>
  );
}

function Row({ label, value, bold, indent, negative, positive, big }) {
  return (
    <div className={`flex justify-between py-1.5 ${bold ? 'font-extrabold border-t-2 border-slate-300 mt-1 pt-2' : ''} ${big ? 'text-lg' : 'text-sm'}`}>
      <span className={indent ? 'pl-5' : ''}>{label}</span>
      <span className={negative ? 'text-rose-600 font-bold' : positive ? 'text-emerald-600 font-bold' : ''}>{value}</span>
    </div>
  );
}

export default function FinancePage() {
  const router = useRouter();
  const [tab, setTab] = useState('pnl');
  const [error, setError] = useState('');
  const user = typeof window !== 'undefined' ? getUser() : null;

  // P&L
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [pnl, setPnl] = useState(null);
  const pnlRef = useRef(null);
  // Balance sheet
  const [bs, setBs] = useState(null);
  const bsRef = useRef(null);
  // Management lists
  const [expenses, setExpenses] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [capital, setCapital] = useState([]);
  const [assets, setAssets] = useState([]);
  // Forms
  const [expForm, setExpForm] = useState({ category: 'salary', description: '', amount: '', expense_date: today() });
  const [recForm, setRecForm] = useState({ category: 'rent', description: '', amount: '' });
  const [capForm, setCapForm] = useState({ type: 'investment', description: '', amount: '', entry_date: today() });
  const [assetForm, setAssetForm] = useState({ name: '', category: 'equipment', cost: '', purchase_date: today(), notes: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && !['admin', 'superadmin'].includes(user.role)) router.replace('/dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPnl = useCallback(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    api(`/finance/pnl?${q}`).then(setPnl).catch((e) => setError(e.message));
  }, [from, to]);

  const loadTab = useCallback(() => {
    setError('');
    if (tab === 'pnl') loadPnl();
    if (tab === 'balance') api('/finance/balance-sheet').then(setBs).catch((e) => setError(e.message));
    if (tab === 'expenses') api('/finance/expenses').then(setExpenses).catch((e) => setError(e.message));
    if (tab === 'recurring') api('/finance/recurring').then(setRecurring).catch((e) => setError(e.message));
    if (tab === 'capital') api('/finance/capital').then(setCapital).catch((e) => setError(e.message));
    if (tab === 'assets') api('/finance/assets').then(setAssets).catch((e) => setError(e.message));
  }, [tab, loadPnl]);

  useEffect(() => { loadTab(); }, [loadTab]);

  async function submit(path, body, reset) {
    setBusy(true); setError('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      reset();
      loadTab();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  async function remove(path) {
    if (!confirm('Delete this entry? Reports recalculate automatically.')) return;
    try { await api(path, { method: 'DELETE' }); loadTab(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="card p-2 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-bold transition ${
                    tab === t.key ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      {/* ================= P&L ================= */}
      {tab === 'pnl' && (
        <>
          <div className="card p-4 flex flex-wrap items-end gap-3">
            <div><label className="label">From</label>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="label">To</label>
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            {pnl && (
              <button className="btn-primary ml-auto"
                      onClick={() => elementToPdf(pnlRef.current, `profit-loss-${from}-to-${to}.pdf`)}>
                ⤓ Save as PDF
              </button>
            )}
          </div>

          {pnl && (
            <div ref={pnlRef} className="card doc-black max-w-2xl mx-auto p-8" style={{ background: '#fff' }}>
              <Letterhead title="PROFIT & LOSS" sub={`${fmtDate(pnl.from)} — ${fmtDate(pnl.to)}`} />
              <Row label={`Revenue (${pnl.orders} orders billed)`} value={money(pnl.revenue)} />
              <Row label="− Cost of fabric used (COGS)" value={`(${money(pnl.cogs)})`} indent />
              <Row label="GROSS PROFIT" value={money(pnl.gross_profit)} bold
                   positive={pnl.gross_profit >= 0} negative={pnl.gross_profit < 0} />

              <p className="text-[11px] font-extrabold uppercase tracking-wide mt-5 mb-1 text-brand-700">Operating Expenses</p>
              {pnl.expenses.map((e) => (
                <Row key={e.category} label={e.category[0].toUpperCase() + e.category.slice(1)} value={`(${money(e.total)})`} indent />
              ))}
              {!pnl.expenses.length && <p className="text-sm pl-5 py-1">No expenses recorded in this period.</p>}
              <Row label="Total expenses" value={`(${money(pnl.expenses_total)})`} bold />

              <div className={`mt-5 rounded-xl p-4 flex justify-between items-center text-xl font-extrabold ${
                pnl.net_profit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                <span>NET {pnl.net_profit >= 0 ? 'PROFIT' : 'LOSS'}</span>
                <span>{money(Math.abs(pnl.net_profit))}</span>
              </div>
              <p className="text-[11px] mt-3">
                Cash actually collected in this period: <b>{money(pnl.collected)}</b>.
                Revenue counts what was billed; uncollected balances appear on the balance sheet as receivables.
              </p>
            </div>
          )}
        </>
      )}

      {/* ================= BALANCE SHEET ================= */}
      {tab === 'balance' && bs && (
        <>
          <div className="flex justify-end">
            <button className="btn-primary"
                    onClick={() => elementToPdf(bsRef.current, `balance-sheet-${bs.as_of}.pdf`)}>
              ⤓ Save as PDF
            </button>
          </div>
          <div ref={bsRef} className="card doc-black max-w-3xl mx-auto p-8" style={{ background: '#fff' }}>
            <Letterhead title="BALANCE SHEET" sub={`As of ${fmtDate(bs.as_of)}`} />
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <p className="text-[12px] font-extrabold uppercase tracking-wide text-brand-700 border-b-2 border-brand-700 pb-1 mb-2">Assets</p>
                <Row label="Cash in hand" value={money(bs.assets.cash)} />
                <Row label="Receivables (customers owe)" value={money(bs.assets.receivables)} />
                <Row label="Fabric inventory (at cost)" value={money(bs.assets.inventory)} />
                <Row label="Fixed assets (machines…)" value={money(bs.assets.fixed_assets)} />
                <Row label="TOTAL ASSETS" value={money(bs.assets.total)} bold big />
              </div>
              <div>
                <p className="text-[12px] font-extrabold uppercase tracking-wide text-brand-700 border-b-2 border-brand-700 pb-1 mb-2">Equity</p>
                <Row label="Capital invested" value={money(bs.equity.capital_invested)} />
                <Row label="− Withdrawals" value={`(${money(bs.equity.capital_withdrawn)})`} indent />
                <Row label="Net capital" value={money(bs.equity.capital_net)} />
                <Row label="Retained earnings (profit kept)" value={money(bs.equity.retained_earnings)}
                     positive={bs.equity.retained_earnings >= 0} negative={bs.equity.retained_earnings < 0} />
                <Row label="TOTAL EQUITY" value={money(bs.equity.total)} bold big />
              </div>
            </div>
            <div className={`mt-6 rounded-xl px-4 py-3 text-sm font-bold text-center ${
              bs.balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {bs.balanced
                ? '✓ Balanced — Assets equal Capital + Retained Earnings'
                : `⚠ Off by ${money(bs.difference)} — usually cash spent before the system started tracking. Record it as a capital entry to correct.`}
            </div>
          </div>
        </>
      )}

      {/* ================= EXPENSES ================= */}
      {tab === 'expenses' && (
        <>
          <form className="card p-5 grid grid-cols-2 md:grid-cols-5 gap-3"
                onSubmit={(e) => { e.preventDefault();
                  submit('/finance/expenses', expForm,
                    () => setExpForm({ category: 'salary', description: '', amount: '', expense_date: today() })); }}>
            <div><label className="label">Category *</label>
              <select className="input" value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}>
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
              </select></div>
            <div><label className="label">Amount ($) *</label>
              <input className="input" type="number" step="0.01" min="0.01" required value={expForm.amount}
                     onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} /></div>
            <div><label className="label">Date *</label>
              <input className="input" type="date" required value={expForm.expense_date}
                     onChange={(e) => setExpForm({ ...expForm, expense_date: e.target.value })} /></div>
            <div><label className="label">Description</label>
              <input className="input" value={expForm.description} placeholder="e.g. July rent"
                     onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} /></div>
            <div className="flex items-end"><button className="btn-primary w-full" disabled={busy}>+ Add Expense</button></div>
          </form>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="th">Date</th><th className="th">Category</th><th className="th">Description</th>
                <th className="th">By</th><th className="th text-right">Amount</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="table-row">
                    <td className="td">{fmtDate(e.expense_date)}</td>
                    <td className="td"><span className="chip-amber">{e.category.toUpperCase()}</span></td>
                    <td className="td">
                      {e.description || '—'}
                      {(e.description || '').includes('(auto)') && <span className="chip-blue ml-1.5">AUTO</span>}
                    </td>
                    <td className="td text-slate-400">{e.created_by_name || 'System'}</td>
                    <td className="td text-right font-extrabold text-rose-600">{money(e.amount)}</td>
                    <td className="td text-right">
                      <button className="text-rose-500 hover:text-rose-700 text-xs font-bold px-2"
                              onClick={() => remove(`/finance/expenses/${e.id}`)}>✕</button>
                    </td>
                  </tr>
                ))}
                {!expenses.length && <tr><td className="td text-slate-400" colSpan={6}>No expenses recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ================= RECURRING (rent & fixed monthly) ================= */}
      {tab === 'recurring' && (
        <>
          <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 text-sm text-brand-800">
            🔁 Record rent (or any fixed monthly cost) <b>once</b> — the system posts it as an expense
            automatically on the <b>1st of every month</b>. Staff salaries work the same way: set each
            person&apos;s salary on the <b>Staff</b> page and it posts monthly too. Deleting an auto-posted
            expense skips only that month.
          </div>
          <form className="card p-5 grid grid-cols-2 md:grid-cols-4 gap-3"
                onSubmit={(e) => { e.preventDefault();
                  submit('/finance/recurring', recForm,
                    () => setRecForm({ category: 'rent', description: '', amount: '' })); }}>
            <div><label className="label">Category *</label>
              <select className="input" value={recForm.category} onChange={(e) => setRecForm({ ...recForm, category: e.target.value })}>
                {RECURRING_CATS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
              </select></div>
            <div><label className="label">Amount per month ($) *</label>
              <input className="input" type="number" step="0.01" min="0.01" required value={recForm.amount}
                     onChange={(e) => setRecForm({ ...recForm, amount: e.target.value })} /></div>
            <div><label className="label">Description</label>
              <input className="input" value={recForm.description} placeholder="e.g. Shop rent"
                     onChange={(e) => setRecForm({ ...recForm, description: e.target.value })} /></div>
            <div className="flex items-end"><button className="btn-primary w-full" disabled={busy}>+ Add Fixed Cost</button></div>
          </form>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="th">Category</th><th className="th">Description</th>
                <th className="th text-right">Monthly Amount</th><th className="th text-right">Months Posted</th>
                <th className="th">Status</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {recurring.map((r) => (
                  <tr key={r.id} className={`table-row ${!r.active ? 'opacity-50' : ''}`}>
                    <td className="td"><span className="chip-amber">{r.category.toUpperCase()}</span></td>
                    <td className="td">{r.description || '—'}</td>
                    <td className="td text-right font-extrabold text-rose-600">{money(r.amount)}/mo</td>
                    <td className="td text-right font-bold">{r.months_posted}</td>
                    <td className="td">
                      <button className={r.active ? 'chip-green' : 'chip-red'}
                              onClick={() => api(`/finance/recurring/${r.id}`, { method: 'PUT', body: JSON.stringify({ active: !r.active }) }).then(loadTab).catch((e) => setError(e.message))}>
                        {r.active ? 'ACTIVE' : 'PAUSED'}
                      </button>
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      <button className="btn-outline !px-2 !py-1 text-xs mr-1.5"
                              onClick={() => {
                                const amt = prompt('New monthly amount ($):', r.amount);
                                if (amt && Number(amt) > 0) {
                                  api(`/finance/recurring/${r.id}`, { method: 'PUT', body: JSON.stringify({ amount: Number(amt) }) })
                                    .then(loadTab).catch((e) => setError(e.message));
                                }
                              }}>✏️</button>
                      <button className="text-rose-500 hover:text-rose-700 text-xs font-bold px-2"
                              onClick={() => remove(`/finance/recurring/${r.id}`)}>✕</button>
                    </td>
                  </tr>
                ))}
                {!recurring.length && (
                  <tr><td className="td text-slate-400" colSpan={6}>
                    Nothing yet — add your shop rent as the first fixed monthly cost.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ================= CAPITAL ================= */}
      {tab === 'capital' && (
        <>
          <form className="card p-5 grid grid-cols-2 md:grid-cols-5 gap-3"
                onSubmit={(e) => { e.preventDefault();
                  submit('/finance/capital', capForm,
                    () => setCapForm({ type: 'investment', description: '', amount: '', entry_date: today() })); }}>
            <div><label className="label">Type *</label>
              <select className="input" value={capForm.type} onChange={(e) => setCapForm({ ...capForm, type: e.target.value })}>
                <option value="investment">Investment (money IN)</option>
                <option value="withdrawal">Withdrawal (money OUT)</option>
              </select></div>
            <div><label className="label">Amount ($) *</label>
              <input className="input" type="number" step="0.01" min="0.01" required value={capForm.amount}
                     onChange={(e) => setCapForm({ ...capForm, amount: e.target.value })} /></div>
            <div><label className="label">Date *</label>
              <input className="input" type="date" required value={capForm.entry_date}
                     onChange={(e) => setCapForm({ ...capForm, entry_date: e.target.value })} /></div>
            <div><label className="label">Description</label>
              <input className="input" value={capForm.description} placeholder="e.g. Opening capital"
                     onChange={(e) => setCapForm({ ...capForm, description: e.target.value })} /></div>
            <div className="flex items-end"><button className="btn-primary w-full" disabled={busy}>+ Record</button></div>
          </form>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="th">Date</th><th className="th">Type</th><th className="th">Description</th>
                <th className="th">By</th><th className="th text-right">Amount</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {capital.map((c) => (
                  <tr key={c.id} className="table-row">
                    <td className="td">{fmtDate(c.entry_date)}</td>
                    <td className="td">
                      <span className={c.type === 'investment' ? 'chip-green' : 'chip-red'}>
                        {c.type === 'investment' ? 'IN' : 'OUT'}
                      </span>
                    </td>
                    <td className="td">{c.description || '—'}</td>
                    <td className="td text-slate-400">{c.created_by_name}</td>
                    <td className={`td text-right font-extrabold ${c.type === 'investment' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {c.type === 'investment' ? '+' : '−'}{money(c.amount)}
                    </td>
                    <td className="td text-right">
                      <button className="text-rose-500 hover:text-rose-700 text-xs font-bold px-2"
                              onClick={() => remove(`/finance/capital/${c.id}`)}>✕</button>
                    </td>
                  </tr>
                ))}
                {!capital.length && (
                  <tr><td className="td text-slate-400" colSpan={6}>
                    Nothing yet — record the money you started the business with as your first <b>Investment</b>.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ================= ASSETS ================= */}
      {tab === 'assets' && (
        <>
          <form className="card p-5 grid grid-cols-2 md:grid-cols-6 gap-3"
                onSubmit={(e) => { e.preventDefault();
                  submit('/finance/assets', assetForm,
                    () => setAssetForm({ name: '', category: 'equipment', cost: '', purchase_date: today(), notes: '' })); }}>
            <div><label className="label">Asset name *</label>
              <input className="input" required value={assetForm.name} placeholder="e.g. Sewing machine"
                     onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} /></div>
            <div><label className="label">Category</label>
              <select className="input" value={assetForm.category} onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })}>
                {ASSET_CATS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
              </select></div>
            <div><label className="label">Cost ($) *</label>
              <input className="input" type="number" step="0.01" min="0" required value={assetForm.cost}
                     onChange={(e) => setAssetForm({ ...assetForm, cost: e.target.value })} /></div>
            <div><label className="label">Purchase date</label>
              <input className="input" type="date" value={assetForm.purchase_date}
                     onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })} /></div>
            <div><label className="label">Notes</label>
              <input className="input" value={assetForm.notes}
                     onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })} /></div>
            <div className="flex items-end"><button className="btn-primary w-full" disabled={busy}>+ Add Asset</button></div>
          </form>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="th">Asset</th><th className="th">Category</th><th className="th">Purchased</th>
                <th className="th">Status</th><th className="th text-right">Cost</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className={`table-row ${!a.active ? 'opacity-50' : ''}`}>
                    <td className="td font-bold text-slate-700">{a.name}{a.notes && <p className="text-[10.5px] text-slate-400 font-normal">{a.notes}</p>}</td>
                    <td className="td capitalize">{a.category}</td>
                    <td className="td">{fmtDate(a.purchase_date)}</td>
                    <td className="td">
                      <button onClick={() => api(`/finance/assets/${a.id}`, { method: 'PUT', body: JSON.stringify({ active: !a.active }) }).then(loadTab)}
                              className={a.active ? 'chip-green' : 'chip-red'}>
                        {a.active ? 'IN USE' : 'DISPOSED'}
                      </button>
                    </td>
                    <td className="td text-right font-extrabold">{money(a.cost)}</td>
                    <td className="td text-right">
                      <button className="text-rose-500 hover:text-rose-700 text-xs font-bold px-2"
                              onClick={() => remove(`/finance/assets/${a.id}`)}>✕</button>
                    </td>
                  </tr>
                ))}
                {!assets.length && <tr><td className="td text-slate-400" colSpan={6}>No assets yet — add your machines, furniture, POS…</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
