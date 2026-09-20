'use client';
import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, money, fmtDate, getUser, GARMENTS, garmentLabel, TROUSER_FIELDS, COAT_FIELDS, PAYMENT_METHODS, paymentMethodLabel, vatFor } from '@/lib/api';
import SearchSelect from '@/components/SearchSelect';
import { T } from '@/lib/labels';

const STEPS = ['Customer', 'Measurements', 'Order Details', 'Payment', 'Review'];

// Which measurement section(s) each garment needs
const MEASURE_REQUIREMENTS = {
  suit: ['trouser', 'coat'],        // a suit needs both
  safari_suit: ['trouser', 'coat'],
  trouser: ['trouser'],
  shirt: ['coat'],
  khamiis: ['coat'],
  jacket: ['coat'],
  other: [],
};
const SECTION_LABELS = { trouser: 'Trouser / Shalwar', coat: 'Coat / Kameez' };

// Every line declares what KIND of sale it is. Defaulting to tailoring keeps
// the familiar flow unchanged for the shop's main business.
function emptyItem(line_type = 'tailoring') {
  return { line_type, garment_type: 'suit', fabric_id: '', variant_id: '', meters: '', qty: 1, unit_price: '' };
}

function NewOrderInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fabrics, setFabrics] = useState([]);
  const [variants, setVariants] = useState([]);

  // Step 1 — customer (name + phone only; contact info stays private to admin)
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  // Step 2 — measurements
  const [trouser, setTrouser] = useState({});
  const [coat, setCoat] = useState({});
  // Step 3 — items + appointment
  const [items, setItems] = useState([emptyItem()]);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [tailors, setTailors] = useState([]);
  const [tailorId, setTailorId] = useState('');
  // Step 4 — payment
  const [advance, setAdvance] = useState('');
  const [method, setMethod] = useState('cash');
  const [advanceDate, setAdvanceDate] = useState(''); // optional — blank = today
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');

  useEffect(() => {
    api('/users/tailors').then(setTailors).catch(() => {});
    api('/products/variants').then(setVariants).catch(() => {});
    api('/fabrics').then((fs) => {
      setFabrics(fs);
      const pre = params.get('fabric');
      if (pre) {
        const f = fs.find((x) => x.code.toUpperCase() === pre.toUpperCase());
        if (f) setItems([{ ...emptyItem(), fabric_id: String(f.id) }]);
      }
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function variantById(id) { return variants.find((v) => String(v.id) === String(id)); }

  // What each line costs. This mirrors priceItems() on the server exactly —
  // cloth prices itself from the fabric, products from the variant, and only
  // the sewing charge is typed. The server recomputes all of it on save, so
  // this is a preview, never the source of truth.
  function lineAmount(it) {
    const qty = Number(it.qty) || 1;
    if (it.line_type === 'product') {
      const v = variantById(it.variant_id);
      if (!v) return 0;
      const unit = it.unit_price === '' || it.unit_price === undefined
        ? Number(v.sell_price) : Number(it.unit_price);
      return Math.round((unit || 0) * qty * 100) / 100;
    }
    const fb = fabricById(it.fabric_id);
    const cloth = fb && Number(it.meters) > 0
      ? Math.round(Number(it.meters) * Number(fb.price_per_meter) * 100) / 100 : 0;
    if (it.line_type === 'fabric') return cloth;
    return Math.round((cloth + (Number(it.unit_price) || 0) * qty) * 100) / 100;
  }

  const itemsTotal = useMemo(
    () => items.reduce((s, it) => s + lineAmount(it), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, fabrics, variants]
  );
  // Does this order contain anything that has to be SEWN? That single fact
  // decides whether a collection date, a tailor and measurements apply.
  const hasTailoring = items.some((it) => it.line_type === 'tailoring');
  // The subtotal is computed, not typed — the salesman no longer quotes a
  // single number covering cloth and labour together.
  const subtotal = Math.round(itemsTotal * 100) / 100;
  const discountValue = Math.min(Number(discount) || 0, subtotal);
  const finalPrice = Math.round((subtotal - discountValue) * 100) / 100;
  // VAT comes off the PRICE, not the advance, and it is fixed the moment the
  // order is created. Cash orders are never taxed, so their total = price.
  const orderVat = vatFor(method, finalPrice);
  const totalWithVat = finalPrice + orderVat;
  const balance = totalWithVat - (Number(advance) || 0);

  function fabricById(id) { return fabrics.find((f) => String(f.id) === String(id)); }

  // How many meters of a fabric are still free, given what OTHER item rows
  // in this same order have already claimed (excludeIndex is this row —
  // its own meters aren't counted against itself).
  function remainingForFabric(fabricId, excludeIndex) {
    const f = fabricById(fabricId);
    if (!f) return 0;
    const claimedElsewhere = items.reduce((sum, it, idx) => {
      if (idx === excludeIndex) return sum;
      if (String(it.fabric_id) !== String(fabricId)) return sum;
      return sum + (Number(it.meters) || 0);
    }, 0);
    return Number(f.quantity_meters) - claimedElsewhere;
  }

  function setItem(i, patch) {
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  // Check that every selected garment has its measurement section fully filled.
  // Returns an error string, or null when everything is complete.
  function measurementError() {
    const required = new Set();
    // Only sewing needs measurements. A customer buying shoes or taking cloth
    // away has nothing to measure, and demanding a chest size for a pair of
    // kabo would be absurd.
    items.filter((it) => it.line_type === 'tailoring')
         .forEach((it) => (MEASURE_REQUIREMENTS[it.garment_type] || []).forEach((s) => required.add(s)));
    for (const section of required) {
      const fields = section === 'trouser' ? TROUSER_FIELDS : COAT_FIELDS;
      const data = section === 'trouser' ? trouser : coat;
      const missing = fields.filter(([k]) => !String(data[k] || '').trim()).map(([, l]) => l);
      if (missing.length) {
        const garment = items.find((it) => it.line_type === 'tailoring' && (MEASURE_REQUIREMENTS[it.garment_type] || []).includes(section));
        return `You selected ${garmentLabel(garment?.garment_type)} — the ${SECTION_LABELS[section]} measurements are required but incomplete. ` +
               `Go back to Step 2 (Measurements) and fill: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`;
      }
    }
    return null;
  }

  function validateStep() {
    setError('');

    // Step 1 — customer: the name is required, the phone is not. Plenty of
    // customers would rather not give a number, and refusing the order over
    // it is worse than not being able to call them. If one IS given it still
    // has to be a real number, so a typo can't be saved silently.
    if (step === 0) {
      if (!customer.name.trim() || customer.name.trim().length < 3) {
        setError('Enter the customer’s full name (at least 3 characters).'); return false;
      }
      if (customer.phone.trim() && !/^\+?[0-9\s-]{7,15}$/.test(customer.phone.trim())) {
        setError('That phone number doesn’t look right (digits only, 7–15 characters, e.g. +252 61 5551234). Leave it blank if the customer prefers not to give one.'); return false;
      }
    }

    // Step 2 — measurements are checked against the SELECTED GARMENTS in step 3,
    // so nothing is forced here. Fill only the section(s) the customer needs.

    // Step 3 — items + appointment
    if (step === 2) {
      if (!items.length) { setError('Add at least one item.'); return false; }
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const n = i + 1;
        if (!Number(it.qty) || Number(it.qty) < 1) {
          setError(`Item ${n}: quantity must be at least 1.`); return false;
        }

        // ---- Ready-made ----
        if (it.line_type === 'product') {
          const v = variantById(it.variant_id);
          if (!v) { setError(`Item ${n}: choose which item is being sold.`); return false; }
          const claimed = items.reduce((sum, x, idx) =>
            idx !== i && String(x.variant_id) === String(it.variant_id) ? sum + (Number(x.qty) || 0) : sum, 0);
          if (Number(it.qty) + claimed > Number(v.quantity)) {
            setError(`Only ${v.quantity} of ${v.product_name}${v.size ? ` · ${v.size}` : ''} in stock`
              + (claimed ? ` (another row above already takes ${claimed}).` : '.'));
            return false;
          }
          continue;
        }

        const f = fabricById(it.fabric_id);

        // ---- Cut cloth to take away ----
        if (it.line_type === 'fabric') {
          if (!f) { setError(`Item ${n}: choose which fabric is being sold.`); return false; }
          if (!Number(it.meters) || Number(it.meters) <= 0) {
            setError(`Item ${n}: enter how many yards of ${f.code} are being sold.`); return false;
          }
        } else {
          // ---- Fabric + sewing ----
          if (f && (!Number(it.meters) || Number(it.meters) <= 0)) {
            setError(`Item ${n}: enter how many yards of ${f.code} are needed.`); return false;
          }
          // With the shop's own cloth the sewing charge may be zero (a
          // goodwill make-up); with the customer's cloth it is the whole
          // price, so it cannot be.
          if (!f && (!Number(it.unit_price) || Number(it.unit_price) <= 0)) {
            setError(`Item ${n}: with the customer's own cloth, the sewing charge is the whole price — enter it.`);
            return false;
          }
        }

        if (f) {
          const remaining = remainingForFabric(it.fabric_id, i);
          if (Number(it.meters) > remaining) {
            setError(`Fabric ${f.code} has only ${remaining} yards left for this order (you entered ${it.meters} — another item above already uses the rest of the ${f.quantity_meters} in stock).`);
            return false;
          }
        }
      }
      // Selected garments must have their measurement sections filled — hard stop
      const mErr = measurementError();
      if (mErr) { setError(mErr); return false; }
      // Only a job that gets sewn needs a collection date.
      if (hasTailoring && !deliveryDate) {
        setError('Set the appointment date — the customer must know when to come.'); return false;
      }
    }

    // Step 4 — payment
    if (step === 3) {
      if (!subtotal || subtotal <= 0) { setError('Order total must be greater than zero.'); return false; }
      if ((Number(discount) || 0) < 0) { setError('Discount cannot be negative.'); return false; }
      if ((Number(discount) || 0) > subtotal) {
        setError(`Discount cannot be more than the order total of ${money(subtotal)}.`); return false;
      }
      if ((Number(advance) || 0) < 0) { setError('Advance cannot be negative.'); return false; }
      // Checked against the TOTAL, not the bare price. On a non-cash order the
      // customer owes price + VAT, so paying the whole thing up front is a
      // perfectly normal advance — comparing against the price alone rejected
      // exactly the customer who paid in full (25.00 price, 26.25 owed).
      if ((Number(advance) || 0) > totalWithVat) {
        setError(`Advance cannot be more than the total of ${money(totalWithVat)}${
          orderVat > 0 ? ` (price ${money(finalPrice)} + VAT ${money(orderVat)})` : ''}.`);
        return false;
      }
    }
    return true;
  }

  function next() { if (validateStep()) setStep(step + 1); }

  async function submit() {
    if (!validateStep()) return;
    // Final safety check before saving — never allow an order whose selected
    // garments are missing their measurements
    const mErr = measurementError();
    if (mErr) { setError(mErr); return; }
    setSaving(true);
    setError('');
    try {
      const order = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer,
          measurements: { trouser, coat },
          // Only the facts go to the server; it does the arithmetic itself
          // from the fabric's price per yard and the variant's price. No total
          // is sent, because a total from the browser is a total anyone could
          // edit before it arrives.
          items: items.map((it) => ({
            line_type: it.line_type,
            garment_type: it.line_type === 'tailoring' ? it.garment_type : null,
            fabric_id: it.line_type !== 'product' && it.fabric_id ? Number(it.fabric_id) : null,
            variant_id: it.line_type === 'product' && it.variant_id ? Number(it.variant_id) : null,
            meters: it.line_type === 'product' ? 0 : Number(it.meters) || 0,
            qty: it.line_type === 'fabric' ? 1 : Number(it.qty) || 1,
            // Tailoring: the sewing charge. Product: a price override, or
            // blank to use the variant's own price.
            unit_price: it.line_type === 'fabric' ? null
                      : (it.unit_price === '' ? null : Number(it.unit_price)),
          })),
          discount_amount: Number(discount) || 0,
          discount_reason: discountReason.trim() || null,
          advance_amount: Number(advance) || 0,
          advance_method: method,
          vat_method: method,   // decides the order's VAT (cash = none)
          advance_date: advanceDate || null,
          // Both only apply to work that is sewn.
          delivery_date: hasTailoring ? (deliveryDate || null) : null,
          tailor_id: hasTailoring && tailorId ? Number(tailorId) : null,
          notes,
          // Order number and date are always generated by the server.
        }),
      });
      // Salesmen go straight to the printable receipt; admins to the order detail
      const u = getUser();
      router.push(u?.role === 'admin' ? `/orders/${order.id}?created=1` : `/print/${order.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Stepper with progress line */}
      <div className="card px-8 py-6">
        <div className="relative flex justify-between">
          <div className="absolute top-[15px] left-0 right-0 h-0.5 bg-slate-200" />
          <div className="absolute top-[15px] left-0 h-0.5 bg-brand-600 transition-all duration-500"
               style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => i < step && setStep(i)}
                    className="relative z-10 flex flex-col items-center gap-2 group"
                    disabled={i > step}>
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold border-2 transition-all
                ${i === step ? 'bg-brand-600 border-brand-600 text-white ring-4 ring-brand-600/15 scale-110'
                  : i < step ? 'bg-brand-600 border-brand-600 text-white group-hover:ring-4 group-hover:ring-brand-600/15'
                  : 'bg-white border-slate-300 text-slate-400'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className={`text-[11px] font-bold uppercase tracking-wide hidden sm:block
                ${i <= step ? 'text-brand-700' : 'text-slate-400'}`}>
                {s}
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="card p-6">
        {/* STEP 1 — Customer */}
        {step === 0 && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <h2 className="font-bold text-lg">1. Customer Contact Information</h2>
              <p className="text-sm text-gray-400">If the phone number already exists, the order is linked to that customer automatically.</p>
            </div>
            <div><label className="label">Full Name *</label>
              <input className="input" value={customer.name} autoFocus
                     onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="e.g. Ali Dahir" /></div>
            <div><label className="label">Phone <span className="font-normal text-slate-400">(optional)</span></label>
              <input className="input" value={customer.phone}
                     onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="Leave blank if not given" /></div>
            <div className="md:col-span-2 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 text-xs text-brand-800">
              🔒 Customer privacy: the phone number is stored securely and visible to the <b>admin only</b> after this step.
              Leave it blank if the customer would rather not give one — without it the order simply can&apos;t be
              matched to their previous visits automatically, and there&apos;s no WhatsApp link on the receipt.
            </div>
          </div>
        )}

        {/* STEP 2 — Measurements */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-bold text-lg">2. Body Measurements</h2>
              <p className="text-sm text-gray-400">
                Fill only the section(s) the customer needs — trouser only? Fill Trouser/Shalwar and skip the coat.
                In the next step we verify the sections against the garments you select (a suit needs both sections).
                Fractions like 41½ are fine.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-brand-700 border-b-2 border-brand-600 inline-block pb-1 mb-3 uppercase text-sm tracking-wide">
                Trouser / Shalwar
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {TROUSER_FIELDS.map(([k, label]) => (
                  <div key={k}><label className="label">{label}</label>
                    <input className="input" value={trouser[k] || ''}
                           onChange={(e) => setTrouser({ ...trouser, [k]: e.target.value })} /></div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-brand-700 border-b-2 border-brand-600 inline-block pb-1 mb-3 uppercase text-sm tracking-wide">
                Coat / Kameez
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {COAT_FIELDS.map(([k, label]) => (
                  <div key={k}><label className="label">{label}</label>
                    <input className="input" value={coat[k] || ''}
                           onChange={(e) => setCoat({ ...coat, [k]: e.target.value })} /></div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3 — Order details */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-bold text-lg">3. Order Details</h2>
              <p className="text-sm text-gray-400">What is being sold.</p>
            </div>

            {items.map((it, i) => {
              const f = fabricById(it.fabric_id);
              const v = variantById(it.variant_id);
              const remaining = f ? remainingForFabric(it.fabric_id, i) : null;
              const overRequested = f && Number(it.meters) > remaining;
              const isProduct = it.line_type === 'product';
              const isFabricOnly = it.line_type === 'fabric';
              return (
                <div key={i} className="border rounded-xl p-4 grid grid-cols-2 md:grid-cols-6 gap-3 relative">
                  {/* What KIND of sale is this line? Chosen first, because it
                      decides which of the fields below even apply. */}
                  <div className="col-span-2 md:col-span-6 -mb-1">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-bold">
                      {[['tailoring', T.lineTailoring], ['fabric', T.lineFabric], ['product', T.lineProduct]]
                        .map(([val, label]) => (
                        <button key={val} type="button"
                          onClick={() => setItem(i, {
                            line_type: val,
                            // Clear whatever no longer applies, so a leftover
                            // fabric can't ride along on a shoe sale.
                            fabric_id: val === 'product' ? '' : it.fabric_id,
                            variant_id: val === 'product' ? it.variant_id : '',
                            meters: val === 'product' ? '' : it.meters,
                            unit_price: '',
                            qty: val === 'fabric' ? 1 : it.qty,
                          })}
                          className={`px-3 py-1.5 rounded-md transition ${
                            it.line_type === val ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {isProduct ? (
                    <div className="col-span-2 md:col-span-3">
                      <label className="label">{T.products} — type the name</label>
                      <SearchSelect
                        placeholder="Search by name…"
                        value={it.variant_id}
                        onChange={(val) => setItem(i, { variant_id: val, unit_price: '' })}
                        options={variants.map((pv) => {
                          const claimed = items.reduce((sum, x, idx) =>
                            idx !== i && String(x.variant_id) === String(pv.id) ? sum + (Number(x.qty) || 0) : sum, 0);
                          const left = Number(pv.quantity) - claimed;
                          const isCurrent = String(pv.id) === String(it.variant_id);
                          return {
                            value: String(pv.id),
                            label: `${pv.product_name}${pv.size ? ` · ${pv.size}` : ''}${pv.color ? ` · ${pv.color}` : ''}`,
                            hint: left <= 0 ? 'Out of stock' : `${left} in stock · ${money(pv.sell_price)}`,
                            search: `${pv.product_name} ${pv.brand || ''} ${pv.size || ''} ${pv.color || ''} ${pv.category_name || ''}`,
                            disabled: left <= 0 && !isCurrent,
                          };
                        })}
                      />
                      {v && (
                        <p className="text-xs mt-1 text-green-600">
                          {money(v.sell_price)} each · {v.quantity} in stock
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="label">Garment {isFabricOnly ? '' : '*'}</label>
                      <select className="input" value={it.garment_type} disabled={isFabricOnly}
                              onChange={(e) => setItem(i, { garment_type: e.target.value })}>
                        {GARMENTS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                      </select>
                    </div>
                  )}
                  {!isProduct && (
                  <div className="col-span-2">
                    <label className="label">{T.fabrics} — type a name, code or colour</label>
                    {/* Searchable rather than a plain dropdown: the catalogue
                        is far too long to scroll when there's no scanner to
                        hand, and staff usually know part of the code or name. */}
                    <SearchSelect
                      placeholder="— Own fabric / none —"
                      value={it.fabric_id}
                      onChange={(v) => {
                        const fb = fabricById(v);
                        setItem(i, { fabric_id: v,
                                     unit_price: it.unit_price || (fb ? '' : it.unit_price) });
                      }}
                      options={fabrics.map((fb) => {
                        const rem = remainingForFabric(fb.id, i);
                        const isCurrent = String(fb.id) === String(it.fabric_id);
                        return {
                          value: String(fb.id),
                          label: `${fb.name} · ${fb.code}`,
                          hint: rem <= 0 && !isCurrent
                            ? 'Out of stock'
                            : `${rem} yd ${rem === Number(fb.quantity_meters) ? 'available' : 'left for this order'}`
                              + [fb.color, fb.brand].filter(Boolean).map((s) => ` · ${s}`).join(''),
                          // Match on everything printed on the label, so a
                          // half-remembered colour or brand still finds it.
                          search: `${fb.code} ${fb.name} ${fb.color || ''} ${fb.brand || ''}`,
                          disabled: rem <= 0 && !isCurrent,
                        };
                      })}
                    />
                    {f && (
                      <p className={`text-xs mt-1 ${overRequested ? 'text-red-600 font-semibold' : remaining > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {overRequested
                          ? `⚠ Only ${remaining} yd left — another item above already uses the rest of the ${Number(f.quantity_meters)} yd in stock`
                          : `${remaining} yd available${remaining !== Number(f.quantity_meters) ? ` (of ${Number(f.quantity_meters)} yd total, some reserved by another item above)` : ''}`}
                      </p>
                    )}
                  </div>
                  )}
                  {!isProduct && (
                    <div>
                      <label className="label">Yards</label>
                      <input className={`input ${overRequested ? 'border-red-400 focus:border-red-500' : ''}`}
                             type="number" step="0.1" min="0" value={it.meters}
                             onChange={(e) => setItem(i, { meters: e.target.value })} />
                      {f && Number(it.meters) > 0 && (
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {money(Number(it.meters) * Number(f.price_per_meter))} of cloth
                        </p>
                      )}
                    </div>
                  )}
                  {!isFabricOnly && (
                    <div>
                      <label className="label">Qty</label>
                      <input className="input" type="number" min="1" value={it.qty}
                             onChange={(e) => setItem(i, { qty: e.target.value })} />
                    </div>
                  )}
                  {!isFabricOnly && (
                    <div>
                      <label className="label">
                        {isProduct ? 'Price each ($)' : `${T.sewingCharge} ($)`}
                      </label>
                      <input className="input" type="number" step="0.01" min="0"
                             value={it.unit_price}
                             placeholder={isProduct && v ? String(v.sell_price) : '0.00'}
                             onChange={(e) => setItem(i, { unit_price: e.target.value })} />
                    </div>
                  )}
                  {/* What this line comes to — cloth and sewing shown apart, so
                      the customer can be told exactly what they are paying for. */}
                  <div className="col-span-2 md:col-span-6 flex justify-end items-baseline gap-3 border-t border-slate-100 pt-2 -mt-1">
                    {!isProduct && f && Number(it.meters) > 0 && (
                      <span className="text-[11px] text-slate-400">
                        cloth {money(Number(it.meters) * Number(f.price_per_meter))}
                        {!isFabricOnly && Number(it.unit_price) > 0 &&
                          ` + sewing ${money(Number(it.unit_price) * (Number(it.qty) || 1))}`}
                      </span>
                    )}
                    <span className="text-sm font-extrabold text-slate-700">{money(lineAmount(it))}</span>
                  </div>
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems(items.filter((_, x) => x !== i))}
                            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white text-xs">✕</button>
                  )}
                </div>
              );
            })}
            <button type="button" className="btn-outline border-dashed w-full py-3" onClick={() => setItems([...items, emptyItem()])}>
              + Add another garment — mix different fabrics in the same order
            </button>

            {/* Live check: selected garments vs filled measurement sections */}
            {measurementError() && (
              <div className="bg-rose-50 border-2 border-rose-300 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-rose-700">⚠ {measurementError()}</p>
                <button type="button" onClick={() => setStep(1)}
                        className="btn bg-rose-600 text-white hover:bg-rose-700 !py-1.5 !px-3 text-xs whitespace-nowrap shrink-0">
                  ← Fill Measurements
                </button>
              </div>
            )}

            {/* A collection date and a tailor only mean something when there
                is work to do. On a sale of cloth or ready-made goods the
                customer leaves with it, so these are hidden entirely rather
                than sitting there asking to be filled in. */}
            <div className={`grid gap-4 pt-2 border-t ${hasTailoring ? 'md:grid-cols-3' : 'md:grid-cols-1'}`}>
              {hasTailoring && (
                <>
                  <div>
                    <label className="label">📅 {T.appointment} *</label>
                    <input className="input" type="date" required value={deliveryDate}
                           onChange={(e) => setDeliveryDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">✂️ {T.assign} {T.tailors}</label>
                    <SearchSelect
                      placeholder="—"
                      value={tailorId}
                      onChange={setTailorId}
                      options={tailors.map((t) => ({
                        value: t.id, label: `${t.staff_no ? t.staff_no + ' — ' : ''}${t.name}`, hint: t.phone,
                        search: `${t.staff_no || ''} ${t.name} ${t.phone || ''}`,
                      }))}
                    />
                  </div>
                </>
              )}
              <div>
                <label className="label">Notes</label>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* STEP 4 — Payment */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-bold text-lg">4. Payment</h2>
              <p className="text-sm text-gray-400">Totals add up from the items.</p>
            </div>

            {/* Running total, shown before anything is typed so the salesman
                can read the figure straight off the screen to the customer. */}
            <div className="card p-4 bg-slate-50/60">
              <div className="flex justify-between py-1 text-sm">
                <span>Items total</span><b>{money(subtotal)}</b>
              </div>
              {discountValue > 0 && (
                <div className="flex justify-between py-1 text-sm text-rose-600">
                  <span>− {T.discount}</span><b>−{money(discountValue)}</b>
                </div>
              )}
              {orderVat > 0 && (
                <div className="flex justify-between py-1 text-sm text-amber-700">
                  <span>+ VAT 5% ({paymentMethodLabel(method)})</span><b>{money(orderVat)}</b>
                </div>
              )}
              <div className="flex justify-between py-2 mt-1 border-t border-slate-200 text-lg font-extrabold">
                <span>Customer pays</span><span>{money(totalWithVat)}</span>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="label">{T.discount} ($)</label>
                <input className="input text-lg font-bold" type="number" step="0.01" min="0"
                       max={subtotal} value={discount}
                       onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
              </div>
              <div className="md:col-span-2">
                <label className="label">Sababta</label>
                <input className="input" value={discountReason} disabled={!Number(discount)}
                       onChange={(e) => setDiscountReason(e.target.value)}
                       placeholder="—" />
              </div>
              <div>
                <label className="label">Advance amount ($)</label>
                <input className="input text-lg font-bold" type="number" step="0.01" min="0" value={advance}
                       onChange={(e) => setAdvance(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="label">Payment method</label>
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {orderVat > 0 && (
                <div>
                  <label className="label">VAT (5%) on the price</label>
                  <div className="input text-lg font-bold text-amber-600 bg-amber-50">
                    {money(orderVat)}
                  </div>
                </div>
              )}
              <div>
                <label className="label">Total ($)</label>
                <div className="input text-lg font-bold bg-gray-50">
                  {money(totalWithVat)}
                </div>
              </div>
              <div>
                <label className="label">Balance ($)</label>
                <div className={`input text-lg font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'} bg-gray-50`}>
                  {money(balance)}
                </div>
              </div>
            </div>
            <div className="max-w-xs">
              <label className="label">Payment date</label>
              <input className="input" type="date" value={advanceDate}
                     onChange={(e) => setAdvanceDate(e.target.value)} />
            </div>
            {orderVat > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {paymentMethodLabel(method)} is taxed, so 5% VAT ({money(orderVat)}) is added to the
                price of {money(finalPrice)}. The customer owes <b>{money(totalWithVat)}</b> in total —
                pay that and the order is fully paid. Choose Cash for no VAT.
              </p>
            )}
            <div className={`rounded-xl p-4 text-sm font-semibold ${
              balance <= 0 ? 'bg-green-50 text-green-700' : (Number(advance) || 0) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
              Payment status will be: {balance <= 0 ? 'FULLY PAID ✅' : (Number(advance) || 0) > 0 ? 'PARTIAL — balance remains' : 'UNPAID'}
            </div>
          </div>
        )}

        {/* STEP 5 — Review */}
        {step === 4 && (
          <div className="space-y-5">
            <h2 className="font-bold text-lg">5. Review &amp; Confirm</h2>

            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="border rounded-xl p-4">
                <h3 className="font-bold text-brand-700 mb-2">Customer</h3>
                <p className="font-semibold">{customer.name}</p>
                <p className="text-gray-500">{customer.phone ? '🔒 Phone recorded' : 'No phone'}</p>
              </div>
              <div className="border rounded-xl p-4">
                {/* Nothing to collect on a walk-out sale, so the review shows
                    what actually happens instead of an empty date. */}
                <h3 className="font-bold text-brand-700 mb-2">
                  {hasTailoring ? T.appointment : 'Iibka'}
                </h3>
                <p className="font-semibold">
                  {hasTailoring
                    ? (deliveryDate ? fmtDate(deliveryDate) : 'Not set')
                    : 'Macmiilku wuu qaadanayaa hadda'}
                </p>
                {notes && <p className="text-gray-500 mt-1">📝 {notes}</p>}
              </div>
            </div>

            <div className="border rounded-xl p-4 text-sm">
              <h3 className="font-bold text-brand-700 mb-2">Items</h3>
              {items.map((it, i) => {
                const f = fabricById(it.fabric_id);
                return (
                  <div key={i} className="flex justify-between py-1 border-b last:border-0">
                    <span>{it.qty} × {garmentLabel(it.garment_type)}{f ? ` — ${f.code} ${f.name}` : ' — own fabric'}{Number(it.meters) ? ` (${it.meters} m)` : ''}</span>
                    <span className="font-semibold">{money((Number(it.unit_price) || 0) * (Number(it.qty) || 1))}</span>
                  </div>
                );
              })}
            </div>

            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="border rounded-xl p-4">
                <h3 className="font-bold text-brand-700 mb-2">Measurements</h3>
                <p className="text-xs text-gray-500 uppercase font-semibold">Trouser / Shalwar</p>
                <p className="mb-2">{TROUSER_FIELDS.filter(([k]) => trouser[k]).map(([k, l]) => `${l}: ${trouser[k]}`).join(' · ') || '—'}</p>
                <p className="text-xs text-gray-500 uppercase font-semibold">Coat / Kameez</p>
                <p>{COAT_FIELDS.filter(([k]) => coat[k]).map(([k, l]) => `${l}: ${coat[k]}`).join(' · ') || '—'}</p>
              </div>
              <div className="border rounded-xl p-4 bg-brand-50/50">
                <h3 className="font-bold text-brand-700 mb-2">Payment</h3>
                <div className="flex justify-between py-1"><span>Items total</span><b>{money(subtotal)}</b></div>
                {discountValue > 0 && (
                  <div className="flex justify-between py-1 text-rose-600">
                    <span>{T.discount}{discountReason ? ` — ${discountReason}` : ''}</span>
                    <b>−{money(discountValue)}</b>
                  </div>
                )}
                {orderVat > 0 && (
                  <div className="flex justify-between py-1"><span>VAT (5%)</span><b className="text-amber-700">{money(orderVat)}</b></div>
                )}
                <div className="flex justify-between py-1 border-t mt-1 pt-2"><span>Total</span><b>{money(totalWithVat)}</b></div>
                <div className="flex justify-between py-1"><span>Advance ({paymentMethodLabel(method)})</span><b className="text-green-700">{money(advance)}</b></div>
                <div className="flex justify-between py-1 border-t mt-1 pt-2 text-base">
                  <span>Balance</span><b className={balance > 0 ? 'text-red-600' : 'text-green-600'}>{money(balance)}</b>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400">After submitting you can print the 80mm receipt from the order page.</p>
          </div>
        )}
      </div>

      {/* Nav buttons */}
      <div className="flex justify-between">
        <button className="btn-outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || saving}>
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button className="btn-primary px-8" onClick={next}>Continue →</button>
        ) : (
          <button className="btn-primary px-8" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : '✓ Submit Order'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function NewOrderPage() {
  return <Suspense fallback={null}><NewOrderInner /></Suspense>;
}
