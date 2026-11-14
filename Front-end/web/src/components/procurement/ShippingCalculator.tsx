'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Trash2, Truck } from 'lucide-react';
import { CatalogSuggestions } from './CatalogSuggestions';
import { errorMessage } from './enquiry';
import { rupees } from './pricing';
import { estimateShipping, isPincode, type ShippingEstimate } from './shipping';

/**
 * Delivery charge estimate for a pincode, from the delivery zones the site
 * already uses (base rate + per kg). Read-only: it never changes an order,
 * a cart or what checkout charges.
 */

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

type Picked = { productId: string; name: string; qty: number };
const kg = (n: number) => `${Number(n.toFixed(3))} kg`;
const rupeesText = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

export default function ShippingCalculator({ freightHref }: {
  /** Price calculator link; the estimate is appended as ?freight=. */
  freightHref?: string;
}) {
  const [pin, setPin] = useState('');
  const [weight, setWeight] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [problem, setProblem] = useState('');
  const run = useMutation({ mutationFn: estimateShipping });
  const result = run.data?.estimate;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem('');
    if (!isPincode(pin)) { setProblem('Enter a 6-digit pincode, e.g. 682001.'); return; }
    if (weight.trim() && !/^\d+(\.\d{1,3})?$/.test(weight.trim())) { setProblem('Weight should be in kg, e.g. 2 or 2.5.'); return; }
    run.mutate({ pin: pin.replace(/\s/g, ''), weightKg: weight.trim(), items: picked.map(({ productId, qty }) => ({ productId, qty })) });
  }

  const pick = (p: { id: string; name: string }) => {
    setSearch('');
    setPicked((list) => (list.some((x) => x.productId === p.id) ? list : [...list, { productId: p.id, name: p.name, qty: 1 }]));
  };
  const setQty = (id: string, qty: number) => setPicked((l) => l.map((x) => (x.productId === id ? { ...x, qty } : x)));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={submit} aria-label="Shipping fee calculator" className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={label} htmlFor="sc-pin">Delivery pincode</label>
            <input id="sc-pin" className={input} inputMode="numeric" autoComplete="postal-code" maxLength={7} value={pin}
              placeholder="e.g. 682001" onChange={(e) => setPin(e.target.value)} /></div>
          <div><label className={label} htmlFor="sc-weight">Weight (kg)</label>
            <input id="sc-weight" className={input} inputMode="decimal" value={weight} placeholder={picked.length ? 'Extra, besides the products' : 'e.g. 2.5'}
              onChange={(e) => setWeight(e.target.value)} /></div>
        </div>
        <div>
          <label className={label} htmlFor="sc-product">Add products (optional — adds up their packed weight)</label>
          <input id="sc-product" className={input} autoComplete="off" value={search} placeholder="Search our catalogue" onChange={(e) => setSearch(e.target.value)} />
          <CatalogSuggestions query={search} onPick={pick} />
          {picked.length > 0 && (
            <ul aria-label="Picked products" className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {picked.map((p) => (
                <li key={p.productId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-gray-800">{p.name}</span>
                  <label className="sr-only" htmlFor={`sc-qty-${p.productId}`}>Quantity of {p.name}</label>
                  <input id={`sc-qty-${p.productId}`} type="number" min={1} max={10000} className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    value={p.qty} onChange={(e) => setQty(p.productId, Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPicked((l) => l.filter((x) => x.productId !== p.productId))}
                    className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(problem || run.isError) && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{problem || errorMessage(run.error, 'Could not work out the delivery charge. Please try again.')}</p>
        )}
        <button type="submit" disabled={run.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Work out delivery charge
        </button>
        <p className="text-xs text-gray-500">An estimate from our delivery zones (base rate + per kg). It does not change what checkout charges.</p>
      </form>

      <section aria-label="Estimate" aria-live="polite" className="lg:sticky lg:top-4 lg:self-start">
        {result ? <Result r={result} freightHref={freightHref} /> : (
          <div className="rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500">Enter a pincode to see the delivery charge.</div>
        )}
      </section>
    </div>
  );
}

function Result({ r, freightHref }: { r: ShippingEstimate; freightHref?: string }) {
  if (!r.found) {
    return (
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> No delivery rate for {r.pin}</p>
        <p>{r.zonesConfigured === 0
          ? 'No delivery zones are set up yet, so there is no rate to show. The admin needs to add delivery zones (pincodes with a base rate and per-kg rate).'
          : 'This pincode is not in any of our delivery zones. Check the pincode, or ask the admin to add it to a zone.'}</p>
      </div>
    );
  }
  const days = r.deliveryDays.min && r.deliveryDays.max
    ? (r.deliveryDays.min === r.deliveryDays.max ? `${r.deliveryDays.min} days` : `${r.deliveryDays.min}–${r.deliveryDays.max} days`) : null;
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Estimated delivery charge</div>
        <div className="text-3xl font-bold text-gray-900" data-testid="shipping-total">{rupees(r.totalPaise)}</div>
        <div className="text-sm text-gray-600">To {r.pin} · {r.zone.name}{days && <> · {days}</>}</div>
      </div>
      <dl className="space-y-1 border-t border-gray-100 pt-3 text-sm">
        <div className="flex justify-between"><dt className="text-gray-600">Base rate</dt><dd className="font-medium">{rupees(r.basePaise)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-600">Weight {kg(r.weightKg)} × {rupees(r.perKgPaise)}/kg</dt><dd className="font-medium">{rupees(r.weightPaise)}</dd></div>
        <div className="flex justify-between border-t border-gray-100 pt-1"><dt className="font-semibold text-gray-900">Total</dt><dd className="font-semibold">{rupees(r.totalPaise)}</dd></div>
      </dl>
      {r.items.length > 0 && (
        <p className="text-xs text-gray-500">Products: {r.items.map((i) => `${i.name} × ${i.qty}${i.weightKg != null ? ` (${kg(i.weightKg)} each)` : ''}`).join(', ')}</p>
      )}
      {r.missingWeight.length > 0 && (
        <p role="note" className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
          No packed weight saved for: {r.missingWeight.join(', ')}. They are counted as 0 kg — type their weight above to include it.
        </p>
      )}
      {freightHref && (
        <Link href={`${freightHref}?freight=${encodeURIComponent(rupeesText(r.totalPaise))}`} className="inline-flex text-sm font-medium text-blue-700 hover:underline">
          Use as freight in the price calculator →
        </Link>
      )}
    </div>
  );
}
