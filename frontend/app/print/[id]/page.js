'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, money, fmtDate, garmentLabel, TROUSER_FIELDS, COAT_FIELDS } from '@/lib/api';
import { BRAND } from '@/lib/labels';

export default function PrintReceipt() {
  const { id } = useParams();
  const router = useRouter();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    api(`/orders/${id}`).then(setOrder).catch((e) => setError(e.message));
    // Refresh the timestamp at the exact moment of printing
    const onBeforePrint = () => setNow(new Date());
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, [id]);

  const printedDate = now.toLocaleDateString('en-GB'); // 19/07/2026
  const printedTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // 14:35

  if (error) return <div className="p-10 text-center text-red-600">{error}</div>;
  if (!order) return <div className="p-10 text-center text-gray-400">Preparing receipt…</div>;

  const m = order.measurements || {};
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

      {/* 80mm receipt */}
      <div className="receipt-80 bg-white shadow-lg px-4 py-5 text-[11px] leading-snug" style={{ width: '80mm', fontFamily: 'monospace' }}>
        {/* Printed date (left) and exact time (right) */}
        <div className="flex justify-between font-bold" style={{ fontSize: '11px', marginBottom: '4mm' }}>
          <span>{printedDate}</span>
          <span>{printedTime}</span>
        </div>

        <div className="text-center">
          <p className="font-bold" style={{ fontSize: '14px', letterSpacing: '0.5px' }}>{BRAND.toUpperCase()}</p>
        </div>

        {line}
        <div className="flex justify-between"><span>Receipt No:</span><b>{order.order_no}</b></div>
        <div className="flex justify-between"><span>Date:</span><span>{fmtDate(order.created_at)}</span></div>
        <div className="flex justify-between"><span>Delivery Date:</span><b>{fmtDate(order.delivery_date)}</b></div>
        <div className="flex justify-between"><span>Client:</span><b>{order.customer_name}</b></div>

        {line}
        <p className="font-bold text-center" style={{ fontSize: '10px' }}>ORDER ITEMS</p>
        {/* Each line prints according to what it actually is. A tailoring line
            shows the cloth and the sewing charge separately, so the customer
            can see what they are paying for instead of one unexplained number. */}
        {order.items.map((it) => {
          const cloth = Number(it.fabric_amount) || 0;
          const sewing = (Number(it.unit_price) || 0) * (Number(it.qty) || 1);
          if (it.line_type === 'product') {
            return (
              <div key={it.id} className="mt-1">
                <div className="flex justify-between">
                  <span>{it.qty} × {it.product_name}</span>
                  <b>{money(it.amount)}</b>
                </div>
                <p style={{ fontSize: '9px' }} className="text-gray-600">
                  &nbsp;&nbsp;{[it.variant_size, it.variant_color, it.product_brand].filter(Boolean).join(' · ')}
                </p>
              </div>
            );
          }
          if (it.line_type === 'fabric') {
            return (
              <div key={it.id} className="mt-1">
                <div className="flex justify-between">
                  <span>{it.fabric_code} — {Number(it.meters)} yd</span>
                  <b>{money(it.amount)}</b>
                </div>
                <p style={{ fontSize: '9px' }} className="text-gray-600">
                  &nbsp;&nbsp;{it.fabric_name} (maro kaliya, lama tolin)
                </p>
              </div>
            );
          }
          return (
            <div key={it.id} className="mt-1">
              <div className="flex justify-between">
                <span>{it.qty} × {garmentLabel(it.garment_type)}</span>
                <b>{money(it.amount)}</b>
              </div>
              {it.fabric_code && (
                <p style={{ fontSize: '9px' }} className="text-gray-600">
                  &nbsp;&nbsp;{it.fabric_code} {it.fabric_name} {Number(it.meters) > 0 ? `— ${Number(it.meters)} yd` : ''}
                </p>
              )}
              {(cloth > 0 || sewing > 0) && (
                <p style={{ fontSize: '9px' }} className="text-gray-600">
                  &nbsp;&nbsp;{cloth > 0 ? `maro ${money(cloth)}` : ''}
                  {cloth > 0 && sewing > 0 ? ' + ' : ''}
                  {sewing > 0 ? `tolid ${money(sewing)}` : ''}
                </p>
              )}
            </div>
          );
        })}

        {line}
        {(Number(order.discount_amount) > 0 || Number(order.vat_collected) > 0) && (
          <div className="flex justify-between"><span>Subtotal</span><span>{money(order.price)}</span></div>
        )}
        {Number(order.discount_amount) > 0 && (
          <div className="flex justify-between">
            <span>Qiimo dhimis</span><span>−{money(order.discount_amount)}</span>
          </div>
        )}
        {Number(order.vat_collected) > 0 && (
          <div className="flex justify-between"><span>VAT (5%)</span><span>{money(order.vat_collected)}</span></div>
        )}
        <div className="flex justify-between text-[13px]">
          <b>TOTAL</b>
          <b>{money(Number(order.price) - Number(order.discount_amount || 0) + Number(order.vat_collected || 0))}</b>
        </div>
        <div className="flex justify-between"><span>Advance</span><span>{money(order.paid)}</span></div>
        <div className="flex justify-between text-[13px]">
          <b>BALANCE</b><b>{money(order.balance)}</b>
        </div>
        <p className="text-center mt-1 font-bold" style={{ fontSize: '10px' }}>
          {order.payment_status === 'paid' ? '*** FULLY PAID ***' : order.payment_status === 'partial' ? '— PARTIALLY PAID —' : '! UNPAID !'}
        </p>

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
          All items must be collected within two months from date of order.<br />
          Deposit is non-refundable.
        </p>
      </div>
    </div>
  );
}
