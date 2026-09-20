'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, money, fmtDate, getUser } from '@/lib/api';
import { StatusBadge, PayBadge } from '@/components/Badges';
import {
  IconTrendUp, IconTrendDown, IconClock, IconScissors, IconCheck, IconTruck, IconX,
  IconCalendar, IconAlert,
} from '@/components/Icons';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { T } from '@/lib/labels';

const PERIODS = [
  { value: 'daily', label: T.today },
  { value: 'weekly', label: T.thisWeek },
  { value: 'monthly', label: T.thisMonth },
  { value: 'all', label: T.allTime },
];

const STATUS_META = [
  { key: 'pending', label: T.pending, color: '#f59e0b', Icon: IconClock },
  { key: 'in_progress', label: T.inProgress, color: '#3b82f6', Icon: IconScissors },
  { key: 'completed', label: T.completed, color: '#8b5cf6', Icon: IconCheck },
  { key: 'delivered', label: T.delivered, color: '#10b981', Icon: IconTruck },
  { key: 'cancelled', label: T.cancelled, color: '#94a3b8', Icon: IconX },
];

function Trend({ value, goodWhenDown = false }) {
  if (value === null || value === undefined) return null;
  const up = value >= 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${good ? 'text-emerald-500' : 'text-rose-500'}`}>
      {Math.abs(value)}%
      {up ? <IconTrendUp size={14} /> : <IconTrendDown size={14} />}
    </span>
  );
}

function KpiCard({ title, value, chip, trend, goodWhenDown, barColor, barPct }) {
  return (
    <div className="card card-hover p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-slate-500">{title}</p>
        <span className="chip-blue">{chip}</span>
      </div>
      <div className="flex items-end justify-between mt-3">
        <p className="text-[28px] leading-none font-extrabold text-slate-800">{value}</p>
        <Trend value={trend} goodWhenDown={goodWhenDown} />
      </div>
      <div className="kpi-bar">
        <div className="kpi-bar-fill" style={{ width: `${Math.min(Math.max(barPct, 4), 100)}%`, background: barColor }} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [period, setPeriod] = useState('monthly');
  const [drawer, setDrawer] = useState(null); // 'today' | 'delayed' | null
  const [error, setError] = useState('');
  const user = typeof window !== 'undefined' ? getUser() : null;
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const load = useCallback(() => {
    Promise.all([api(`/dashboard/summary?period=${period}`), api('/dashboard/monthly?months=12')])
      .then(([s, m]) => {
        setSummary(s);
        setMonthly(m.map((r) => ({
          ...r,
          paid: Number(r.paid || 0), unpaid: Number(r.unpaid || 0), billed: Number(r.billed || 0),
        })));
      })
      .catch((e) => setError(e.message));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  // AUTO-REFRESH: the dashboard silently reloads every 15 seconds and whenever
  // you return to the tab — new orders, payments and status changes appear alone.
  useEffect(() => {
    const interval = setInterval(load, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  if (error) return <div className="card p-6 text-rose-600">{error}</div>;
  if (!summary) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="card h-32" />)}
        </div>
        <div className="grid xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="card h-80" />)}
        </div>
      </div>
    );
  }

  const t = summary.totals;
  const tr = summary.trends || {};
  const periodLabel = PERIODS.find((p) => p.value === period)?.label;
  const revenue = Number(t.revenue || 0);
  const collected = Number(t.collected || 0);
  const uncollected = Number(t.uncollected || 0);
  const collectionRate = revenue > 0 ? Math.round((collected / revenue) * 100) : 0;
  const doneRate = t.total_orders > 0
    ? Math.round(((t.completed + t.delivered) / t.total_orders) * 100) : 0;
  const gaugeValue = isAdmin ? collectionRate : doneRate;
  const gaugeData = [
    { value: gaugeValue, fill: '#8b5cf6' },
    { value: 100 - gaugeValue, fill: '#f1f5f9' },
  ];
  const areaTotal = isAdmin
    ? monthly.reduce((s, m) => s + m.paid, 0)
    : monthly.reduce((s, m) => s + (m.orders || 0), 0);

  return (
    <div className="space-y-5">
      {/* Period selector row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-slate-500">
          Welcome back, <b className="text-slate-700">{user?.name?.split(' ')[0]}</b> — here&apos;s your
          {isAdmin ? ' business overview' : ' workload'} · <span className="font-semibold text-brand-700">{periodLabel}</span>
        </p>
        <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`period-btn ${period === p.value ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== Compact alert cards — click to open the side panel ===== */}
      <div className={`grid gap-4 ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button onClick={() => setDrawer('today')}
                className="card card-hover p-4 flex items-center justify-between text-left border-l-4 !border-l-amber-400">
          <span className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
              <IconCalendar size={21} />
            </span>
            <span>
              <span className="block font-bold text-slate-700">{T.appointment}</span>
              <span className="block text-xs text-slate-400">Customers coming today — tap to check readiness</span>
            </span>
          </span>
          <span className="text-3xl font-extrabold text-amber-500">{summary.today_appointments?.length || 0}</span>
        </button>

        {isAdmin && (
          <button onClick={() => setDrawer('delayed')}
                  className="card card-hover p-4 flex items-center justify-between text-left border-l-4 !border-l-rose-500">
            <span className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center">
                <IconAlert size={21} />
              </span>
              <span>
                <span className="block font-bold text-slate-700">{T.delayedOrders}</span>
                <span className="block text-xs text-slate-400">Past their appointment date, still not delivered</span>
              </span>
            </span>
            <span className="text-3xl font-extrabold text-rose-500">{summary.delayed_orders?.length || 0}</span>
          </button>
        )}
      </div>

      {/* ===== KPI cards ===== */}
      <div className={`grid gap-4 ${isAdmin ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-2'}`}>
        <KpiCard title={T.orders} value={t.total_orders} chip={periodLabel} trend={tr.total_orders}
                 barColor="#3b82f6" barPct={t.total_orders ? 100 : 0} />
        {isAdmin && (
          <>
            <KpiCard title={T.revenue} value={money(revenue)} chip={periodLabel} trend={tr.revenue}
                     barColor="#c9a227" barPct={revenue ? 100 : 0} />
            <KpiCard title={T.collected} value={money(collected)} chip={periodLabel} trend={tr.collected}
                     barColor="#10b981" barPct={collectionRate} />
          </>
        )}
        <KpiCard title={T.uncollected} value={money(uncollected)} chip={periodLabel} trend={tr.uncollected}
                 goodWhenDown barColor="#f43f5e" barPct={revenue ? Math.round((uncollected / revenue) * 100) : 0} />
      </div>

      {/* ===== Status cards ===== */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {STATUS_META.map(({ key, label, color, Icon }) => (
          <Link key={key} href={`/orders?status=${key}`} className="card card-hover p-4 flex items-center gap-3.5 group">
            <span className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
                  style={{ background: `${color}18`, color }}>
              <Icon size={21} />
            </span>
            <span>
              <span className="block text-[22px] leading-none font-extrabold text-slate-800">{t[key] || 0}</span>
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1">{label}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* ===== Analytics row ===== */}
      <div className="grid xl:grid-cols-4 gap-4">
        {/* Bar chart */}
        <div className="card p-5 xl:col-span-2">
          <p className="card-title">{isAdmin ? 'Sales Analytics' : 'Orders Analytics'}</p>
          <p className="card-sub">
            {isAdmin ? 'Paid vs unpaid amounts per month — last 12 months' : 'Paid vs unpaid orders per month'}
          </p>
          <ResponsiveContainer width="100%" height={272}>
            <BarChart data={monthly} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} />
              <Tooltip cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15,23,42,.08)', fontSize: 12 }}
                formatter={(v, n) => [isAdmin ? money(v) : v, n]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey={isAdmin ? 'paid' : 'paid_orders'} name="Paid" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={14} />
              <Bar dataKey={isAdmin ? 'unpaid' : 'unpaid_orders'} name="Unpaid" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Gauge */}
        <div className="card p-5 flex flex-col">
          <p className="card-title">{isAdmin ? 'Collection Rate' : 'Work Completed'}</p>
          <p className="card-sub">{periodLabel}</p>
          <div className="relative flex-1 min-h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={gaugeData} dataKey="value" innerRadius="72%" outerRadius="90%"
                     startAngle={90} endAngle={-270} paddingAngle={2} cornerRadius={8} stroke="none">
                  {gaugeData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-4xl font-extrabold text-violet-600">{gaugeValue}<span className="text-xl">%</span></span>
            </div>
          </div>
          <p className="text-center text-[13px] font-bold text-slate-700">
            {isAdmin ? 'of billed money collected' : 'of orders completed or delivered'}
          </p>
          <div className="flex justify-around mt-4 pt-4 border-t border-slate-100">
            <div className="text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Delivered</p>
              <p className="inline-flex items-center gap-1 font-extrabold text-emerald-500 mt-0.5">
                <IconTrendUp size={14} /> {t.delivered || 0}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Pending</p>
              <p className="inline-flex items-center gap-1 font-extrabold text-amber-500 mt-0.5">
                <IconClock size={14} /> {t.pending || 0}
              </p>
            </div>
          </div>
        </div>

        {/* Area chart */}
        <div className="card p-5 flex flex-col">
          <p className="card-title">{isAdmin ? T.collected : T.orders}</p>
          <p className="card-sub">Last 12 months</p>
          <div className="flex items-center gap-2 mt-2">
            <p className="text-2xl font-extrabold text-slate-800">{isAdmin ? money(areaTotal) : areaTotal}</p>
            {monthly.length >= 2 && (() => {
              const key = isAdmin ? 'paid' : 'orders';
              const last = monthly[monthly.length - 1]?.[key] || 0;
              const prev = monthly[monthly.length - 2]?.[key] || 0;
              const v = prev === 0 ? (last > 0 ? 100 : 0) : Math.round(((last - prev) / prev) * 100);
              return (
                <span className={v >= 0 ? 'chip-green' : 'chip-red'}>{v >= 0 ? '+' : ''}{v}%</span>
              );
            })()}
          </div>
          <div className="flex-1 -mx-2 mt-2 min-h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthly}>
                <defs>
                  <linearGradient id="areaBlue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" hide />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v) => [isAdmin ? money(v) : v, isAdmin ? T.collected : T.orders]} />
                <Area dataKey={isAdmin ? 'paid' : 'orders'} stroke="#3b82f6" strokeWidth={2.5}
                      fill="url(#areaBlue)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ===== Bottom row ===== */}
      <div className="grid xl:grid-cols-3 gap-4">
        <div className="card xl:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div>
              <p className="card-title">Recent Orders</p>
              <p className="card-sub">Latest activity across the shop</p>
            </div>
            <Link href="/orders" className="text-xs font-bold text-brand-600 hover:underline">VIEW ALL →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-y border-slate-100 bg-slate-50/60">
                <th className="th">Order</th><th className="th">Customer</th><th className="th">Status</th>
                <th className="th">Payment</th><th className="th text-right">Balance</th>
              </tr></thead>
              <tbody>
                {summary.recent_orders.map((o) => (
                  <tr key={o.id} className="table-row">
                    <td className="td">
                      <Link href={`/orders/${o.id}`} className="font-bold text-brand-700 hover:underline">{o.order_no}</Link>
                      <p className="text-[10.5px] text-slate-400">{fmtDate(o.created_at)}</p>
                    </td>
                    <td className="td font-semibold text-slate-700">{o.customer_name}</td>
                    <td className="td"><StatusBadge status={o.status} /></td>
                    <td className="td"><PayBadge status={o.payment_status} /></td>
                    <td className={`td text-right font-extrabold ${Number(o.balance) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {money(o.balance)}
                    </td>
                  </tr>
                ))}
                {!summary.recent_orders.length && (
                  <tr><td className="td text-slate-400" colSpan={5}>No orders yet — create your first order.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <p className="card-title flex items-center gap-2"><IconCalendar size={17} className="text-brand-600" /> Upcoming Deliveries</p>
            <div className="space-y-1 mt-3">
              {summary.upcoming_deliveries.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`}
                      className="flex items-center justify-between text-sm p-2.5 rounded-lg hover:bg-slate-50 transition">
                  <span>
                    <span className="block font-bold text-slate-700">{o.order_no}</span>
                    <span className="block text-[11px] text-slate-400">{o.customer_name}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[11px] font-bold text-slate-600">{fmtDate(o.delivery_date)}</span>
                    <StatusBadge status={o.status} />
                  </span>
                </Link>
              ))}
              {!summary.upcoming_deliveries.length && <p className="text-sm text-slate-400 mt-1">No upcoming appointments.</p>}
            </div>
          </div>

          <div className="card p-5">
            <p className="card-title flex items-center gap-2"><IconAlert size={17} className="text-amber-500" /> Low Stock Fabrics</p>
            <div className="space-y-2.5 mt-3">
              {summary.low_stock.map((f) => (
                <div key={f.id} className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-bold text-slate-700">{f.code}</span>
                    <span className="text-slate-400"> {f.name}{f.color ? ` · ${f.color}` : ''}</span>
                  </span>
                  <span className="chip-red">{Number(f.quantity_meters)} m</span>
                </div>
              ))}
              {!summary.low_stock.length && <p className="text-sm text-slate-400">All fabrics well stocked ✓</p>}
            </div>
          </div>
        </div>
      </div>

      {/* ===== Slide-over side panel: appointments / delayed ===== */}
      {drawer && (
        <div className="fixed inset-0 z-50" onClick={() => setDrawer(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside onClick={(e) => e.stopPropagation()}
                 className="absolute right-0 inset-y-0 w-full max-w-md bg-white dark:bg-transparent card !rounded-none overflow-y-auto">
            <div className={`sticky top-0 z-10 px-5 py-4 flex items-center justify-between border-b border-slate-100
                            ${drawer === 'today' ? 'bg-amber-50' : 'bg-rose-50'}`}>
              <div>
                <p className="font-extrabold text-slate-800 flex items-center gap-2">
                  {drawer === 'today'
                    ? <><IconCalendar size={18} className="text-amber-500" /> {T.appointment}</>
                    : <><IconAlert size={18} className="text-rose-500" /> {T.delayedOrders}</>}
                </p>
                <p className="text-xs text-slate-500">
                  {drawer === 'today'
                    ? 'Make sure these orders are ready before the customer arrives.'
                    : 'These passed their appointment date and are still not delivered.'}
                </p>
              </div>
              <button onClick={() => setDrawer(null)}
                      className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 font-bold">✕</button>
            </div>

            <div className="p-4 space-y-3">
              {(drawer === 'today' ? summary.today_appointments : summary.delayed_orders)?.map((o) => {
                const ready = o.status === 'completed' || o.status === 'delivered';
                return (
                  <div key={o.id}
                       className={`rounded-xl border p-3.5 ${drawer === 'delayed'
                         ? 'border-rose-200 bg-rose-50/50'
                         : ready ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {isAdmin
                          ? <Link href={`/orders/${o.id}`} className="font-extrabold text-brand-700 hover:underline">{o.order_no}</Link>
                          : <span className="font-extrabold text-slate-700">{o.order_no}</span>}
                        <p className="text-sm font-semibold text-slate-700 truncate">{o.customer_name}</p>
                        <p className="text-[11px] text-slate-400 capitalize truncate">{o.garments}</p>
                        {drawer === 'delayed' && o.tailor_name && (
                          <p className="text-[11px] text-slate-500 mt-0.5">✂️ {o.tailor_name}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {drawer === 'delayed'
                          ? <span className="chip-red">{o.days_late} day{o.days_late > 1 ? 's' : ''} late</span>
                          : <span className={`chip ${ready ? 'chip-green' : 'chip-amber'}`}>{ready ? `✓ ${T.ready}` : T.notReady}</span>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <StatusBadge status={o.status} />
                      {Number(o.balance) > 0
                        ? <span className="text-xs font-extrabold text-rose-600">Owes {money(o.balance)}</span>
                        : <span className="text-xs font-extrabold text-emerald-600">{T.fullyPaid}</span>}
                    </div>
                  </div>
                );
              })}
              {!(drawer === 'today' ? summary.today_appointments : summary.delayed_orders)?.length && (
                <p className="text-sm text-slate-400 text-center py-10">
                  {drawer === 'today' ? 'No customers coming today.' : 'No delayed orders — great work! ✓'}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
