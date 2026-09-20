'use client';
import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, money, fmtDate, whatsappLink } from '@/lib/api';
import { elementToPdf, elementToPdfBlob } from '@/lib/pdf';
import { BRAND } from '@/lib/labels';

function StatementInner() {
  const { id } = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const sheetRef = useRef(null);
  const [from, setFrom] = useState(search.get('from') || '');
  const [to, setTo] = useState(search.get('to') || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Documents always render light, even when the app is in dark mode
  useEffect(() => {
    const had = document.documentElement.classList.contains('dark');
    document.documentElement.classList.remove('dark');
    return () => { if (had) document.documentElement.classList.add('dark'); };
  }, []);

  async function savePdf() {
    if (!sheetRef.current || !data) return;
    setSaving(true);
    try {
      const name = data.customer.name.replace(/\s+/g, '-').toLowerCase();
      await elementToPdf(sheetRef.current, `statement-${name}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) { setError('PDF failed: ' + e.message); }
    setSaving(false);
  }

  // Share the ACTUAL PDF file to WhatsApp.
  // Uses the device share panel (Web Share API) when the browser supports file
  // sharing; otherwise downloads the PDF and opens the customer's chat so you
  // attach it with one click.
  async function sharePdfWhatsapp() {
    if (!sheetRef.current || !data) return;
    setSaving(true);
    setError('');
    try {
      const cname = data.customer.name.replace(/\s+/g, '-').toLowerCase();
      const filename = `statement-${cname}-${new Date().toISOString().slice(0, 10)}.pdf`;
      const blob = await elementToPdfBlob(sheetRef.current);
      const file = new File([blob], filename, { type: 'application/pdf' });
      const text = `${BRAND} — Account statement for ${data.customer.name}. Balance due: ${money(data.totals.balance)}`;

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${BRAND} Statement`, text });
      } else {
        // Fallback: download + open the customer's WhatsApp chat
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        // Customers without a phone number still get their PDF — there is
        // just no chat to open, so don't claim one was.
        const link = whatsappLink(data.customer.phone, text + '\n(PDF attached)');
        if (link) {
          window.open(link, '_blank');
          alert('This browser cannot attach files directly. The PDF was downloaded — attach it in the WhatsApp chat that just opened (📎 → Document).');
        } else {
          alert(`The PDF was downloaded. ${data.customer.name} has no phone number on file, so send it however you normally reach them.`);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError('Share failed: ' + e.message);
    }
    setSaving(false);
  }

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    api(`/reports/statement/${id}?${q}`).then(setData).catch((e) => setError(e.message));
  }, [id, from, to]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="p-10 text-center text-red-600">{error}</div>;
  if (!data) return <div className="p-10 text-center text-gray-400">Preparing statement…</div>;

  const { customer, orders, totals } = data;
  const statusLabel = { paid: 'PAID', partial: 'PARTIAL', unpaid: 'UNPAID' };

  return (
    <div className="min-h-screen bg-gray-300 py-8 flex flex-col items-center print:bg-white print:py-0">
      {/* Controls */}
      <div className="no-print mb-5 flex flex-wrap items-end gap-3 bg-white rounded-2xl shadow p-4">
        <button onClick={() => router.back()} className="btn-outline">← Back</button>
        <div>
          <label className="label">From</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button onClick={() => window.print()} className="btn-outline">🖨️ Print</button>
        <button onClick={savePdf} disabled={saving} className="btn-primary">
          {saving ? 'Generating…' : '⤓ Save as PDF'}
        </button>
        <button onClick={sharePdfWhatsapp} disabled={saving}
                className="btn text-white bg-[#25D366] hover:bg-[#1ebe5b]">
          {saving ? 'Preparing…' : '🟢 Share PDF via WhatsApp'}
        </button>
      </div>

      {/* A4 sheet */}
      {/* @page margin 0 removes the browser's own print header/footer
          (date/time + "Tailor System — Management System" + URL) */}
      <style>{`@media print { @page { size: A4 portrait; margin: 0; } }`}</style>

      <div ref={sheetRef} className="a4-sheet doc-black bg-white shadow-2xl"
           style={{ width: '210mm', minHeight: '297mm', padding: '15mm 15mm 12mm 15mm' /* 1.5cm top/left/right */ }}>
        {/* Letterhead — compact */}
        <div className="flex items-start justify-between border-b-4 border-brand-700 pb-4">
          <div>
            <p className="font-script font-semibold tracking-tight text-5xl text-brand-700 leading-none">{BRAND}</p>
            <p className="text-[11px] tracking-[0.2em] uppercase" style={{ marginTop: '5mm' /* 0.5cm below the wordmark */ }}>
              Management System
            </p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-extrabold tracking-widest">STATEMENT</h1>
            <p className="text-xs mt-1">
              Period: {from ? fmtDate(from) : 'Beginning'} — {to ? fmtDate(to) : 'Today'}
            </p>
          </div>
        </div>

        {/* Customer */}
        <div className="flex justify-between items-end mt-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Statement for</p>
            <p className="text-xl font-extrabold">{customer.name}</p>
            {customer.phone && <p className="text-sm text-gray-500">{customer.phone}</p>}
          </div>
          <div className={`px-4 py-2 rounded-xl text-center ${Number(totals.balance) > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Balance Due</p>
            <p className={`text-2xl font-extrabold ${Number(totals.balance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {money(totals.balance)}
            </p>
          </div>
        </div>

        {/* Orders table */}
        <table className="w-full mt-6 text-[12px]">
          <thead>
            <tr className="bg-brand-700 text-white">
              <th className="px-2 py-2 text-left font-semibold w-20">Date</th>
              <th className="px-2 py-2 text-left font-semibold w-24">Order No</th>
              <th className="px-3 py-2 text-left font-semibold">Items</th>
              <th className="px-3 py-2 text-right font-semibold">Price</th>
              <th className="px-3 py-2 text-right font-semibold">Paid</th>
              <th className="px-3 py-2 text-right font-semibold">Balance</th>
              <th className="px-3 py-2 text-center font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={o.id} className={`border-b ${o.payment_status !== 'paid' ? 'bg-red-50/70' : i % 2 ? 'bg-gray-50' : ''}`}>
                <td className="px-2 py-2 whitespace-nowrap">{fmtDate(o.created_at)}</td>
                <td className="px-2 py-2 font-semibold whitespace-nowrap">{o.order_no}</td>
                <td className="px-3 py-2 capitalize">{o.items_summary || '—'}</td>
                <td className="px-3 py-2 text-right">{money(o.price)}</td>
                <td className="px-3 py-2 text-right text-green-700">{money(o.paid)}</td>
                <td className={`px-3 py-2 text-right font-bold ${Number(o.balance) > 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {money(o.balance)}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[10px] font-extrabold ${
                    o.payment_status === 'paid' ? 'text-green-600' : o.payment_status === 'partial' ? 'text-amber-600' : 'text-red-600'}`}>
                    {statusLabel[o.payment_status]}
                  </span>
                </td>
              </tr>
            ))}
            {!orders.length && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No orders in this period.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-brand-700 font-extrabold text-[13px]">
              <td colSpan={3} className="px-3 py-3 text-right uppercase tracking-wide">Totals</td>
              <td className="px-3 py-3 text-right">{money(totals.billed)}</td>
              <td className="px-3 py-3 text-right text-green-700">{money(totals.paid)}</td>
              <td className={`px-3 py-3 text-right ${Number(totals.balance) > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {money(totals.balance)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        {/* Summary line */}
        <div className="mt-4 text-[12px] text-gray-600">
          <p>
            {orders.length} order{orders.length === 1 ? '' : 's'} in this period ·{' '}
            <b className={data.unpaid_orders > 0 ? 'text-red-600' : 'text-green-600'}>
              {data.unpaid_orders} not fully paid
            </b>
          </p>
        </div>

        {/* Footer */}
        <div className="mt-10 pt-4 border-t text-[10px] text-gray-400 flex justify-between">
          <span>All items must be collected within two months from date of order. Deposit is non-refundable.</span>
          <span>{BRAND} — Thank you for your trust.</span>
        </div>
      </div>
    </div>
  );
}

export default function StatementPage() {
  return <Suspense fallback={null}><StatementInner /></Suspense>;
}
