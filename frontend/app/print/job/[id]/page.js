'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, fmtDate, garmentLabel, TROUSER_FIELDS, COAT_FIELDS } from '@/lib/api';
import { BRAND } from '@/lib/labels';

// Printable, money-free job sheet — everything a tailor needs to make the
// garment. Reachable by admin, salesman and the master tailor. Printed on
// the same 80mm thermal paper as the receipt, so it comes off the same
// workshop printer — no A4 sheets needed.
export default function JobSheet() {
  const { id } = useParams();
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/orders/${id}/job-sheet`).then(setJob).catch((e) => setError(e.message));
  }, [id]);

  // Documents always render light, even when the app is in dark mode
  useEffect(() => {
    const had = document.documentElement.classList.contains('dark');
    document.documentElement.classList.remove('dark');
    return () => { if (had) document.documentElement.classList.add('dark'); };
  }, []);

  if (error) return <div className="p-10 text-center text-red-600">{error}</div>;
  if (!job) return <div className="p-10 text-center text-gray-400">Preparing job sheet…</div>;

  const m = job.measurements || {};
  const line = <div className="border-t border-dashed border-gray-400 my-2" />;
  const trouser = TROUSER_FIELDS.filter(([k]) => m.trouser?.[k]);
  const coat = COAT_FIELDS.filter(([k]) => m.coat?.[k]);

  return (
    <div className="receipt-wrap min-h-screen bg-gray-200 py-8 flex flex-col items-center">
      {/* Thermal paper setup + no browser print header/footer */}
      <style>{`@media print { @page { size: 80mm auto; margin: 0; } }`}</style>
      <div className="no-print mb-4 flex gap-3">
        <button onClick={() => router.back()} className="btn-outline bg-white">← Back</button>
        <button onClick={() => window.print()} className="btn-primary">🖨️ Print</button>
      </div>

      {/* 80mm job sheet */}
      <div className="receipt-80 bg-white shadow-lg px-4 py-5 text-[11px] leading-snug" style={{ width: '80mm', fontFamily: 'monospace' }}>
        <div className="text-center">
          <p className="font-bold" style={{ fontSize: '14px', letterSpacing: '0.5px' }}>{BRAND.toUpperCase()}</p>
          <p className="mt-1 font-bold" style={{ fontSize: '11px' }}>JOB SHEET — NO PRICING</p>
        </div>

        {line}
        <div className="flex justify-between"><span>Order No:</span><b>{job.order_no}</b></div>
        <div className="flex justify-between"><span>Customer:</span><b>{job.customer_name}</b></div>
        <div className="flex justify-between"><span>Appointment:</span><b>{fmtDate(job.delivery_date)}</b></div>
        <div className="flex justify-between"><span>Taken On:</span><span>{job.claimed_at ? fmtDate(job.claimed_at) : '—'}</span></div>
        {job.tailor_name && (
          <div className="flex justify-between"><span>Tailor:</span><b>{job.tailor_staff_no} — {job.tailor_name}</b></div>
        )}

        {job.notes && (
          <>
            {line}
            <p className="font-bold" style={{ fontSize: '10px' }}>NOTES</p>
            <p>{job.notes}</p>
          </>
        )}

        {line}
        <p className="font-bold text-center" style={{ fontSize: '10px' }}>ITEMS TO MAKE</p>
        {/* Only lines that are sewn. A tailor has no business with a pair of
            shoes on the same receipt, and cloth taken away uncut is not work. */}
        {job.items.filter((it) => !it.line_type || it.line_type === 'tailoring').map((it, i) => (
          <div key={i} className="mt-1">
            <div className="flex justify-between">
              <span>{it.qty} × {garmentLabel(it.garment_type)}</span>
            </div>
            <p style={{ fontSize: '9px' }} className="text-gray-600">
              &nbsp;&nbsp;{it.fabric_code
                ? `${it.fabric_code} ${it.fabric_name}${it.fabric_color ? ` · ${it.fabric_color}` : ''}${Number(it.meters) > 0 ? ` — ${it.meters}m` : ''}`
                : "Customer's own fabric"}
            </p>
          </div>
        ))}

        {(trouser.length > 0 || coat.length > 0) && (
          <>
            {line}
            <p className="font-bold text-center" style={{ fontSize: '12px' }}>MEASUREMENTS</p>
            {trouser.length > 0 && (
              <>
                <p className="font-bold mt-1.5" style={{ fontSize: '11px' }}>TROUSER / SHALWAR</p>
                {trouser.map(([k, l]) => (
                  <div key={k} className="flex justify-between items-baseline py-0.5" style={{ fontSize: '12px' }}>
                    <span>{l}</span><b style={{ fontSize: '13px' }}>{m.trouser[k]}</b>
                  </div>
                ))}
              </>
            )}
            {coat.length > 0 && (
              <>
                <p className="font-bold mt-1.5" style={{ fontSize: '11px' }}>COAT / KAMEEZ</p>
                {coat.map(([k, l]) => (
                  <div key={k} className="flex justify-between items-baseline py-0.5" style={{ fontSize: '12px' }}>
                    <span>{l}</span><b style={{ fontSize: '13px' }}>{m.coat[k]}</b>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {line}
        <p className="text-center" style={{ fontSize: '9px' }}>
          No pricing information on this sheet.
        </p>
      </div>
    </div>
  );
}
