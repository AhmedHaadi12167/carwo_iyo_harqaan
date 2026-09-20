'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, money, fmtDate, getUser, whatsappLink } from '@/lib/api';
import { elementToPdf } from '@/lib/pdf';
import { StatusBadge, PayBadge, STATUS_LABELS } from '@/components/Badges';
import { IconReports } from '@/components/Icons';
import SearchSelect from '@/components/SearchSelect';
import { BRAND, T, REPORT_COLS } from '@/lib/labels';

export default function ReportsPage() {
  const router = useRouter();
  const reportRef = useRef(null);
  const [fabrics, setFabrics] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [report, setReport] = useState(null);
  const [byBranch, setByBranch] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({ fabric_id: '', customer_id: '', status: '', from: '', to: '', branch_id: '' });
  // What to include:
  //   summary  = totals only
  //   fabrics  = + revenue and margin by fabric
  //   full     = + every order listed
  //   branches = one row per branch (superadmin only)
  const [detail, setDetail] = useState('summary');
  const user = typeof window !== 'undefined' ? getUser() : null;
  const isSuper = user?.role === 'superadmin';

  // The branch comparison is a report in its own right and needs no other
  // filter, so it counts as "filtered" on its own.
  const hasFilter = detail === 'branches'
    || Object.entries(filters).some(([, v]) => v !== '');

  useEffect(() => {
    if (user && !['admin', 'superadmin'].includes(user.role)) { router.replace('/dashboard'); return; }
    Promise.all([api('/fabrics'), api('/customers')])
      .then(([f, c]) => { setFabrics(f); setCustomers(c); })
      .catch((e) => setError(e.message));
    if (user?.role === 'superadmin') api('/branches').then(setBranches).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(() => {
    if (!hasFilter) { setReport(null); setByBranch(null); return; }
    setLoading(true);
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));

    if (detail === 'branches') {
      const bq = new URLSearchParams();
      if (filters.from) bq.set('from', filters.from);
      if (filters.to) bq.set('to', filters.to);
      api(`/reports/by-branch?${bq}`)
        .then((d) => { setByBranch(d); setReport(null); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
      return;
    }
    api(`/reports?${q}`)
      .then((d) => { setReport(d); setByBranch(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters, hasFilter, detail]);

  useEffect(() => { run(); }, [run]);

  const set = (k) => (v) => setFilters({ ...filters, [k]: v });

  async function savePdf() {
    if (!reportRef.current) return;
    setSaving(true);
    try {
      await elementToPdf(reportRef.current, `report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) { setError('PDF failed: ' + e.message); }
    setSaving(false);
  }

  // Which branch is this report about? Used in the letterhead so a printed
  // page can never be mistaken for another branch's figures.
  const scopeLabel = (() => {
    if (!isSuper) return user?.branch_name || '';
    if (detail === 'branches') return T.allBranches;
    if (filters.branch_id) {
      const b = branches.find((x) => String(x.id) === String(filters.branch_id));
      return b ? `${b.name} (${b.code})` : T.allBranches;
    }
    return T.allBranches;
  })();

  const period = `${filters.from ? fmtDate(filters.from) : 'Beginning'} — ${filters.to ? fmtDate(filters.to) : 'Today'}`;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <p className="text-[13px] text-slate-500">
          {detail === 'branches'
            ? 'Every branch side by side. Pick a date range to narrow the period.'
            : 'Choose a fabric, customer, status or date range — the report appears once you filter.'}
        </p>
        {(report || byBranch) && (
          <div className="flex gap-2">
            {report && (() => {
              const cust = customers.find((c) => String(c.id) === String(filters.customer_id));
              if (!cust) return null;
              const msg =
                `*${BRAND}* — Report for ${cust.name}\n` +
                `Period: ${period}\n` +
                `Orders: ${report.summary.orders}\n` +
                `Total: ${money(report.summary.revenue)}\n` +
                `Paid: ${money(report.summary.collected)}\n` +
                `*Balance due: ${money(report.summary.uncollected)}*`;
              const link = whatsappLink(cust.phone, msg);
              return link ? (
                <a href={link} target="_blank" rel="noopener noreferrer"
                   className="btn text-white bg-[#25D366] hover:bg-[#1ebe5b] text-[13px]">🟢 WhatsApp</a>
              ) : null;
            })()}
            <button onClick={savePdf} disabled={saving} className="btn-primary text-[13px]">
              {saving ? 'Generating…' : '⤓ Save as PDF'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-[13px] rounded-lg px-4 py-2">{error}</div>}

      {/* Filters */}
      <div className={`card p-4 grid grid-cols-2 gap-3 ${isSuper ? 'md:grid-cols-7' : 'md:grid-cols-6'}`}>
        <div>
          <label className="label">Report type</label>
          <select className="input !text-[13px]" value={detail} onChange={(e) => setDetail(e.target.value)}>
            <option value="summary">Revenue summary</option>
            <option value="fabrics">Summary + by fabric</option>
            <option value="streams">Which stream earns?</option>
            <option value="products">Best sellers</option>
            <option value="full">Full (every order)</option>
            {isSuper && <option value="branches">Compare branches</option>}
          </select>
        </div>
        {isSuper && (
          <div>
            <label className="label">Branch</label>
            <select className="input !text-[13px]" value={filters.branch_id}
                    disabled={detail === 'branches'}
                    onChange={(e) => set('branch_id')(e.target.value)}>
              <option value="">{T.allBranches}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Fabric</label>
          <SearchSelect
            placeholder="All fabrics"
            value={filters.fabric_id}
            onChange={set('fabric_id')}
            options={fabrics.map((f) => ({
              value: f.id,
              label: `${f.name} · ${f.code}`,
              hint: isSuper ? `${f.color || ''} ${f.branch_code ? `· ${f.branch_code}` : ''}`.trim() : f.color,
              search: `${f.code} ${f.name} ${f.color || ''} ${f.branch_code || ''}`,
            }))}
          />
        </div>
        <div>
          <label className="label">Customer</label>
          <SearchSelect
            placeholder="All customers"
            value={filters.customer_id}
            onChange={set('customer_id')}
            options={customers.map((c) => ({
              value: c.id, label: c.name, hint: c.phone, search: `${c.name} ${c.phone || ''}`,
            }))}
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input !text-[13px]" value={filters.status} onChange={(e) => set('status')(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input className="input !text-[13px]" type="date" value={filters.from} onChange={(e) => set('from')(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input className="input !text-[13px]" type="date" value={filters.to} onChange={(e) => set('to')(e.target.value)} />
        </div>
      </div>

      {/* Empty state before filtering */}
      {!hasFilter && (
        <div className="card p-12 text-center">
          <span className="inline-flex w-14 h-14 rounded-2xl bg-brand-600/10 text-brand-600 items-center justify-center mb-3">
            <IconReports size={26} />
          </span>
          <p className="font-bold text-slate-700">Build your report</p>
          <p className="text-[13px] text-slate-400 mt-1 max-w-md mx-auto">
            Select a fabric, customer, status or date range above.
            {isSuper && ' Or choose “Compare branches” to see every branch at once.'}
          </p>
        </div>
      )}

      {loading && <div className="card p-8 text-center text-slate-400 text-[13px]">Building report…</div>}

      {/* ============ THE REPORT SHEET ============
          Deliberately compact: 11px body text, tight rows, one accent colour.
          It is printed and photographed a lot, so density beats decoration. */}
      {hasFilter && !loading && (report || byBranch) && (
        <div ref={reportRef} className="space-y-3 bg-white doc-black text-[11px]"
             style={{ padding: '12mm 12mm 10mm 12mm' }}>
          <style>{`@media print { @page { size: A4 portrait; margin: 0; } }`}</style>

          {/* Letterhead — compact */}
          <div className="flex items-start justify-between gap-4 border-b-2 border-brand-700 pb-2.5">
            <div>
              <p className="font-script font-semibold tracking-tight text-3xl text-brand-700 leading-none">{BRAND}</p>
              <p className="text-[9px] tracking-[0.22em] uppercase text-slate-400 mt-1">Management System</p>
            </div>
            <div className="text-right">
              <p className="text-[13px] font-extrabold tracking-[0.18em] text-slate-700">
                {detail === 'branches' ? 'BRANCH COMPARISON' : 'BUSINESS REPORT'}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {scopeLabel && <>Branch: <b>{scopeLabel}</b> · </>}Period: <b>{period}</b>
              </p>
              <p className="text-[9px] text-slate-400">Generated {fmtDate(new Date())}</p>
              <div className="text-[9px] text-slate-500">
                {filters.fabric_id && <span>Fabric: <b>{fabrics.find((f) => String(f.id) === String(filters.fabric_id))?.code}</b> · </span>}
                {filters.customer_id && <span>Customer: <b>{customers.find((c) => String(c.id) === String(filters.customer_id))?.name}</b> · </span>}
                {filters.status && <span>Status: <b>{STATUS_LABELS[filters.status]}</b></span>}
              </div>
            </div>
          </div>

          {/* ---------- BRANCH COMPARISON ---------- */}
          {byBranch && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {[
                  [T.branches, byBranch.combined.branches],
                  [T.orders, byBranch.combined.orders],
                  [T.revenue, money(byBranch.combined.revenue)],
                  [T.uncollected, money(byBranch.combined.uncollected)],
                ].map(([label, value]) => (
                  <div key={label} className="border border-slate-200 rounded-lg px-3 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                    <p className="text-[17px] font-extrabold text-slate-800 leading-tight mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              <table className="w-full">
                <thead><tr className="bg-brand-700 text-white">
                  <th className="th-brand !text-[10px] !py-1.5">{REPORT_COLS.branch}</th>
                  <th className="th-brand !text-[10px] !py-1.5">{REPORT_COLS.code}</th>
                  <th className="th-brand !text-[10px] !py-1.5 text-right">{REPORT_COLS.orders}</th>
                  <th className="th-brand !text-[10px] !py-1.5 text-right">{REPORT_COLS.revenue}</th>
                  <th className="th-brand !text-[10px] !py-1.5 text-right">{REPORT_COLS.collected}</th>
                  <th className="th-brand !text-[10px] !py-1.5 text-right">{REPORT_COLS.outstanding}</th>
                  <th className="th-brand !text-[10px] !py-1.5 text-right">{REPORT_COLS.staff}</th>
                  <th className="th-brand !text-[10px] !py-1.5 text-right">{REPORT_COLS.stockValue}</th>
                  <th className="th-brand !text-[10px] !py-1.5 text-right">{REPORT_COLS.share}</th>
                </tr></thead>
                <tbody>
                  {byBranch.branches.map((b) => {
                    const share = Number(byBranch.combined.revenue) > 0
                      ? Math.round((Number(b.revenue) / Number(byBranch.combined.revenue)) * 1000) / 10
                      : 0;
                    return (
                      <tr key={b.id} className={`border-b border-slate-100 ${!b.active ? 'text-slate-400' : ''}`}>
                        <td className="td !py-1.5 !text-[11px] font-semibold">
                          {b.name}{!b.active && <span className="text-[9px] font-normal"> (closed)</span>}
                        </td>
                        <td className="td !py-1.5 !text-[11px] font-mono">{b.code}</td>
                        <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{b.orders}</td>
                        <td className="td !py-1.5 !text-[11px] text-right tabular-nums font-bold">{money(b.revenue)}</td>
                        <td className="td !py-1.5 !text-[11px] text-right tabular-nums text-emerald-700">{money(b.collected)}</td>
                        <td className={`td !py-1.5 !text-[11px] text-right tabular-nums font-semibold ${Number(b.uncollected) > 0 ? 'text-rose-600' : ''}`}>{money(b.uncollected)}</td>
                        <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{b.staff}</td>
                        <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{money(b.stock_value)}</td>
                        <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{share}%</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-100 font-extrabold">
                    <td className="td !py-1.5 !text-[11px]" colSpan={2}>{REPORT_COLS.total}</td>
                    <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{byBranch.combined.orders}</td>
                    <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{money(byBranch.combined.revenue)}</td>
                    <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{money(byBranch.combined.collected)}</td>
                    <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{money(byBranch.combined.uncollected)}</td>
                    <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{byBranch.combined.staff}</td>
                    <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{money(byBranch.combined.stock_value)}</td>
                    <td className="td !py-1.5 !text-[11px] text-right">100%</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[9px] text-slate-400">
                A branch with no orders in this period still appears, as a row of zeros.
                Closed branches are included so their history stays visible.
              </p>
            </>
          )}

          {/* ---------- SINGLE / COMBINED REPORT ---------- */}
          {report && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {[
                  [T.orders, report.summary.orders],
                  [T.revenue, money(report.summary.revenue)],
                  [T.collected, money(report.summary.collected)],
                  [T.uncollected, money(report.summary.uncollected)],
                ].map(([label, value], i) => (
                  <div key={label} className={`border rounded-lg px-3 py-2 ${
                    i === 3 && Number(report.summary.uncollected) > 0
                      ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200'}`}>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                    <p className={`text-[17px] font-extrabold leading-tight mt-0.5 ${
                      i === 3 && Number(report.summary.uncollected) > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Money given away. Shown whenever any was, on every report type —
                  it is the one figure that shows cash leaving without theft. */}
              {Number(report.summary.discounts) > 0 && (
                <div className="border border-rose-200 bg-rose-50/40 rounded-lg px-3 py-2 flex items-baseline justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-rose-500">
                    {T.discount} — {report.summary.discounted_orders} order(s)
                  </span>
                  <span className="text-[15px] font-extrabold text-rose-600">
                    −{money(report.summary.discounts)}
                  </span>
                </div>
              )}

              {/* Which of the three streams actually earns */}
              {detail === 'streams' && (report.by_line_type || []).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-700 mb-1.5">Waxa xarunta wax u soo galiya</p>
                  <table className="w-full">
                    <thead><tr className="bg-brand-700 text-white">
                      <th className="th-brand !text-[10px] !py-1.5">Nooca iibka</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">{T.orders}</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Xaddi</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">{T.revenue}</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Kharashka</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Faa'iido</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">%</th>
                    </tr></thead>
                    <tbody>
                      {report.by_line_type.map((r) => {
                        const rev = Number(r.revenue) || 0;
                        const pct = rev > 0 ? Math.round((Number(r.margin) / rev) * 1000) / 10 : 0;
                        const label = { tailoring: T.lineTailoring, fabric: T.lineFabric, product: T.lineProduct }[r.line_type] || r.line_type;
                        return (
                          <tr key={r.line_type} className="border-b border-slate-100">
                            <td className="td !py-1.5 !text-[11px] font-semibold">{label}</td>
                            <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{r.orders}</td>
                            <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{r.units}</td>
                            <td className="td !py-1.5 !text-[11px] text-right tabular-nums font-bold">{money(r.revenue)}</td>
                            <td className="td !py-1.5 !text-[11px] text-right tabular-nums text-slate-500">{money(r.cost)}</td>
                            <td className={`td !py-1.5 !text-[11px] text-right tabular-nums font-bold ${
                              Number(r.margin) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{money(r.margin)}</td>
                            <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{pct}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-[9px] text-slate-400 mt-1">
                    Faa&apos;iido = waxa la iibiyay − kharashka alaabta. Kharashka shaqaalaha iyo kirada kuma jiraan.
                  </p>
                </div>
              )}

              {/* Best sellers, per size and colour */}
              {detail === 'products' && (report.by_product || []).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-700 mb-1.5">Alaabta ugu iibka badan</p>
                  <table className="w-full">
                    <thead><tr className="bg-brand-700 text-white">
                      <th className="th-brand !text-[10px] !py-1.5">Alaabta</th>
                      <th className="th-brand !text-[10px] !py-1.5">{T.size}</th>
                      <th className="th-brand !text-[10px] !py-1.5">{T.colour}</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">La iibiyay</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">{T.revenue}</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Faa'iido</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">{T.inStock}</th>
                    </tr></thead>
                    <tbody>
                      {report.by_product.map((r) => (
                        <tr key={r.id} className="border-b border-slate-100">
                          <td className="td !py-1.5 !text-[11px] font-semibold">
                            {r.product_name}
                            {r.category_name && <span className="text-slate-400"> · {r.category_name}</span>}
                          </td>
                          <td className="td !py-1.5 !text-[11px]">{r.size || '—'}</td>
                          <td className="td !py-1.5 !text-[11px]">{r.color || '—'}</td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums font-bold">{r.units_sold}</td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{money(r.revenue)}</td>
                          <td className={`td !py-1.5 !text-[11px] text-right tabular-nums font-semibold ${
                            Number(r.margin) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{money(r.margin)}</td>
                          <td className={`td !py-1.5 !text-[11px] text-right tabular-nums ${
                            Number(r.in_stock) === 0 ? 'text-rose-600 font-bold' : ''}`}>{r.in_stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[9px] text-slate-400 mt-1">
                    Cabbir kasta oo gooni ah — si aad u ogaato midka dhamaaday iyo midka haray.
                  </p>
                </div>
              )}

              {/* Revenue by fabric — with the margin, now that cost is tracked */}
              {(detail === 'fabrics' || detail === 'full') && report.by_fabric.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-700 mb-1.5">Revenue by Fabric</p>
                  <table className="w-full">
                    <thead><tr className="bg-brand-700 text-white">
                      <th className="th-brand !text-[10px] !py-1.5">Code</th>
                      <th className="th-brand !text-[10px] !py-1.5">Fabric</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Orders</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Yards</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Cost/yd</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Price/yd</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Revenue</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Margin</th>
                    </tr></thead>
                    <tbody>
                      {report.by_fabric.map((f) => (
                        <tr key={f.id} className="border-b border-slate-100">
                          <td className="td !py-1.5 !text-[11px] font-mono font-bold">{f.code}</td>
                          <td className="td !py-1.5 !text-[11px]">{f.name} <span className="text-slate-400">{f.color}</span></td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{f.orders}</td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{Number(f.meters_used)} yd</td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums text-slate-500">{money(f.cost_per_meter)}</td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums">{money(f.price_per_meter)}</td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums font-bold text-brand-700">{money(f.revenue)}</td>
                          <td className={`td !py-1.5 !text-[11px] text-right tabular-nums font-semibold ${
                            Number(f.margin) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{money(f.margin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[9px] text-slate-400 mt-1">
                    Margin = revenue from this fabric − (yards used × cost per yard).
                  </p>
                </div>
              )}

              {/* Orders — only in the full report */}
              {detail === 'full' && (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <p className="text-[11px] font-bold text-slate-700">Matching Orders ({report.orders.length})</p>
                    {filters.customer_id && (
                      <Link href={`/statement/${filters.customer_id}?from=${filters.from}&to=${filters.to}`}
                            className="btn-outline !text-[10px] !py-1 no-print">Customer Statement (A4)</Link>
                    )}
                  </div>
                  <table className="w-full">
                    <thead><tr className="bg-brand-700 text-white">
                      <th className="th-brand !text-[10px] !py-1.5 !px-2">Order</th>
                      <th className="th-brand !text-[10px] !py-1.5 !px-2">Date</th>
                      {isSuper && !filters.branch_id && <th className="th-brand !text-[10px] !py-1.5 !px-2">Branch</th>}
                      <th className="th-brand !text-[10px] !py-1.5">Customer</th>
                      <th className="th-brand !text-[10px] !py-1.5">Fabrics</th>
                      <th className="th-brand !text-[10px] !py-1.5">Status</th>
                      <th className="th-brand !text-[10px] !py-1.5">Payment</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Price</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Paid</th>
                      <th className="th-brand !text-[10px] !py-1.5 text-right">Balance</th>
                    </tr></thead>
                    <tbody>
                      {report.orders.map((o) => (
                        <tr key={o.id} className="border-b border-slate-100">
                          <td className="td !py-1.5 !px-2 !text-[11px] whitespace-nowrap">
                            <Link href={`/orders/${o.id}`} className="font-bold text-brand-700 hover:underline">{o.order_no}</Link>
                          </td>
                          <td className="td !py-1.5 !px-2 !text-[11px] text-slate-500 whitespace-nowrap">{fmtDate(o.created_at)}</td>
                          {isSuper && !filters.branch_id && (
                            <td className="td !py-1.5 !px-2 !text-[11px] font-mono text-slate-500">{o.branch_code}</td>
                          )}
                          <td className="td !py-1.5 !text-[11px]">{o.customer_name}</td>
                          <td className="td !py-1.5 !text-[10px] font-mono">{o.fabrics}</td>
                          <td className="td !py-1.5 !text-[11px]"><StatusBadge status={o.status} /></td>
                          <td className="td !py-1.5 !text-[11px]"><PayBadge status={o.payment_status} /></td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums font-semibold">{money(o.price)}</td>
                          <td className="td !py-1.5 !text-[11px] text-right tabular-nums text-emerald-700">{money(o.paid)}</td>
                          <td className={`td !py-1.5 !text-[11px] text-right tabular-nums font-bold ${
                            Number(o.balance) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{money(o.balance)}</td>
                        </tr>
                      ))}
                      {!report.orders.length && (
                        <tr><td className="td !text-[11px] text-slate-400" colSpan={10}>No orders match these filters.</td></tr>
                      )}
                    </tbody>
                  </table>
                  {report.orders.length === 500 && (
                    <p className="text-[9px] text-amber-600 mt-1">
                      Showing the first 500 orders. Narrow the date range to see the rest.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
