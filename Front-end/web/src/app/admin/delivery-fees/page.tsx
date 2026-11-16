'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { deliveryFeeKeys } from '@/hooks/queries/keys';

/**
 * Admin — delivery-fee rate card + remote (ODA) PIN list.
 *
 * Every rate is copied from a real courier bill: customers who do not tap the Black
 * Friday offer actually pay these, and the 2023 dark-patterns guidelines forbid
 * invented fees. The server validates every field (a blank is refused, never saved as
 * ₹0) and checkout uses a change on the very next cart.
 */

interface RateCard {
  chargeAtCheckout: boolean;
  volumetricDivisor: number;
  courier: { maxKg: number; slabKg: number; slabRate: number };
  freight: { minimum: number; docket: number; otherCharges: number; fuel: number; hamaliPerKg: number };
  packing: { small: number; medium: number; large: number; xl: number };
  remoteAreaFee: number;
  insurancePercent: number;
  paymentFeePercent: number;
  paymentFeeGstPercent: number;
  gstOnFees: { enabled: boolean; percent: number };
  origin: { label: string; pin: string; lat: number; lng: number };
  distanceBands: { upToKm: number | null; ratePerKg: number }[];
  updatedAt: string | null;
  remotePinCount: number;
  pinLocationCount: number;
}

type BandRow = { upToKm: string; ratePerKg: string };

type Form = Record<string, string>;

/** [path, label, hint] — the order the owner reads a courier bill in. */
const FIELDS: { title: string; rows: [string, string, string][] }[] = [
  {
    title: 'Weight',
    rows: [['volumetricDivisor', 'Volumetric divisor (cm³ per kg)', 'L×W×H ÷ this. Air Line Express bill: 4500.']],
  },
  {
    title: 'Small parcels (courier)',
    rows: [
      ['courier.maxKg', 'Up to (kg)', 'Heavier carts go as freight.'],
      ['courier.slabKg', 'Slab size (kg)', 'Charged per started slab.'],
      ['courier.slabRate', 'Rate per slab (₹)', 'Delhivery / Trackon small-parcel rate.'],
    ],
  },
  {
    title: 'Freight (heavy / large)',
    rows: [
      ['freight.minimum', 'Minimum freight (₹)', ''],
      ['freight.docket', 'Docket (₹)', 'Shown as Docket / Processing fee.'],
      ['freight.otherCharges', 'Other charges (₹)', 'Added to Docket / Processing fee.'],
      ['freight.fuel', 'Fuel surcharge (₹)', ''],
      ['freight.hamaliPerKg', 'Hamali per kg (₹)', 'Shown as Handling fee.'],
    ],
  },
  {
    title: 'Dispatch point (for the distance)',
    rows: [
      ['origin.label', 'Name shown to customers', 'e.g. Delhi → "~1,260 km from Delhi".'],
      ['origin.pin', 'PIN code', ''],
      ['origin.lat', 'Latitude', 'Delhi: 28.6139'],
      ['origin.lng', 'Longitude', 'Delhi: 77.209'],
    ],
  },
  {
    title: 'Packing (₹ per item, by size class)',
    rows: [
      ['packing.small', 'Small', 'Box.'],
      ['packing.medium', 'Medium', 'Box.'],
      ['packing.large', 'Large', 'Wooden packing for lights etc.'],
      ['packing.xl', 'XL', 'Crate for body kits.'],
    ],
  },
  {
    title: 'Other fees',
    rows: [
      ['remoteAreaFee', 'Remote area fee (₹)', 'Courier ODA charge, only for PINs on the list below.'],
      ['insurancePercent', 'Insurance (% of goods value)', 'VRL freight-on-value: 0.1.'],
      ['paymentFeePercent', 'Razorpay fee (%)', 'Your real Razorpay rate.'],
      ['paymentFeeGstPercent', 'GST on Razorpay fee (%)', 'Razorpay charges 18% GST on its fee.'],
      ['gstOnFees.percent', 'GST on delivery fees (%)', 'Used only if the switch below is on.'],
    ],
  },
];

const get = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v == null ? undefined : (v as Record<string, unknown>)[k]), o);

function toForm(c: RateCard): Form {
  const f: Form = {};
  for (const g of FIELDS) for (const [path] of g.rows) f[path] = String(get(c, path) ?? '');
  return f;
}

/** Form → nested payload. Strings are sent as typed; the server parses and range-checks. */
function toPayload(f: Form, chargeAtCheckout: boolean, gstEnabled: boolean, bands: BandRow[]) {
  const out: Record<string, unknown> = {
    chargeAtCheckout,
    gstOnFees: { enabled: gstEnabled },
    distanceBands: bands.map((b, i) => ({ upToKm: i === bands.length - 1 ? null : b.upToKm.trim(), ratePerKg: b.ratePerKg.trim() })),
  };
  for (const [path, value] of Object.entries(f)) {
    const keys = path.split('.');
    let node = out as Record<string, unknown>;
    keys.slice(0, -1).forEach((k) => { node[k] = (node[k] as Record<string, unknown>) || {}; node = node[k] as Record<string, unknown>; });
    node[keys[keys.length - 1]] = value.trim();
  }
  return out;
}

const box = 'rounded-lg border border-gray-200 bg-white p-6';
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2';

export default function DeliveryFeesAdminPage() {
  const qc = useQueryClient();
  const config = useQuery({
    queryKey: deliveryFeeKeys.admin(),
    queryFn: () => apiClient.get<{ config: RateCard }>(API_ENDPOINTS.DELIVERY_FEES_ADMIN).then((r) => r.config),
  });

  const [form, setForm] = useState<Form>({});
  const [charge, setCharge] = useState(false);
  const [gstOn, setGstOn] = useState(true);
  const [bands, setBands] = useState<BandRow[]>([]);
  useEffect(() => {
    if (!config.data) return;
    setForm(toForm(config.data));
    setBands(config.data.distanceBands.map((b) => ({ upToKm: b.upToKm == null ? '' : String(b.upToKm), ratePerKg: String(b.ratePerKg) })));
    setCharge(config.data.chargeAtCheckout);
    setGstOn(config.data.gstOnFees.enabled);
  }, [config.data]);

  const save = useMutation({
    mutationFn: () => apiClient.put<{ config: RateCard }>(API_ENDPOINTS.DELIVERY_FEES_ADMIN, toPayload(form, charge, gstOn, bands)).then((r) => r.config),
    onSuccess: (c) => {
      qc.setQueryData(deliveryFeeKeys.admin(), c);
      qc.invalidateQueries({ queryKey: deliveryFeeKeys.public() });
    },
  });

  const [pinText, setPinText] = useState('');
  const [pinNote, setPinNote] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const addPins = useMutation({
    mutationFn: () => apiClient.post<{ received: number; added: number; alreadyListed: number }>(
      API_ENDPOINTS.DELIVERY_FEES_REMOTE_PINS, { text: pinText, note: pinNote || null },
    ),
    onSuccess: (r) => {
      setPinMsg(`Added ${r.added} PIN${r.added === 1 ? '' : 's'} (${r.alreadyListed} were already on the list).`);
      setPinText('');
      qc.invalidateQueries({ queryKey: deliveryFeeKeys.all });
    },
  });
  const removePins = useMutation({
    mutationFn: () => apiClient.post<{ received: number; removed: number }>(API_ENDPOINTS.DELIVERY_FEES_REMOTE_PINS_REMOVE, { text: pinText }),
    onSuccess: (r) => {
      setPinMsg(`Removed ${r.removed} PIN${r.removed === 1 ? '' : 's'}.`);
      setPinText('');
      qc.invalidateQueries({ queryKey: deliveryFeeKeys.all });
    },
  });

  const [prefix, setPrefix] = useState('');
  const pins = useQuery({
    queryKey: deliveryFeeKeys.remotePins(prefix),
    queryFn: () => apiClient.get<{ pins: { pin: string; note: string | null }[]; nextCursor: string | null }>(
      `${API_ENDPOINTS.DELIVERY_FEES_REMOTE_PINS}?limit=100${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}`,
    ),
    enabled: /^\d{0,6}$/.test(prefix),
  });

  if (config.isLoading) return <div className="p-6">Loading…</div>;
  if (config.error) return <div className="p-6 text-red-600" role="alert">{(config.error as Error).message}</div>;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">Delivery fees</h1>
      <p className="text-gray-600 mb-6">
        The itemised fees customers see in the cart and at checkout. Every rate must come from a real courier bill —
        customers who don&apos;t tap the Black Friday offer pay them. Changes apply to the very next cart.
      </p>

      <div className={`${box} mb-6 space-y-4`}>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="h-5 w-5 mt-0.5" checked={charge} onChange={(e) => setCharge(e.target.checked)} data-testid="charge-at-checkout" />
          <span>
            <span className="font-medium">Charge delivery fees at checkout</span>
            <span className="block text-xs text-gray-500">
              Off = the old way (&quot;shipping extra, paid on delivery&quot;). On = fees are paid online with the order —
              book every parcel PREPAID so the courier does not collect again.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="h-5 w-5 mt-0.5" checked={gstOn} onChange={(e) => setGstOn(e.target.checked)} />
          <span>
            <span className="font-medium">Add GST on delivery fees</span>
            <span className="block text-xs text-gray-500">Check with your accountant (composite supply: GST at the product&apos;s rate).</span>
          </span>
        </label>
      </div>

      {FIELDS.map((g) => (
        <fieldset key={g.title} className={`${box} mb-6`}>
          <legend className="px-1 font-semibold">{g.title}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {g.rows.map(([path, label, hint]) => (
              <div key={path}>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`df-${path}`}>{label}</label>
                <input
                  id={`df-${path}`}
                  inputMode="decimal"
                  className={input}
                  value={form[path] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [path]: e.target.value }))}
                />
                {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className={`${box} mb-6`}>
        <legend className="px-1 font-semibold">Freight rate by distance (₹ per kg)</legend>
        <p className="mb-3 text-xs text-gray-500">
          Distance is a straight line from the dispatch point to the customer&apos;s PIN. A PIN we cannot place uses the
          last band. Today&apos;s bills charge ₹16/kg everywhere (Air Line Express; VRL ₹13.10).
          {' '}PIN locations loaded: {config.data?.pinLocationCount ?? 0}.
        </p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-600"><th className="py-1">Up to (km)</th><th className="py-1">₹ per kg</th><th /></tr></thead>
          <tbody>
            {bands.map((b, i) => {
              const last = i === bands.length - 1;
              return (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    {last ? <span className="text-gray-600">and above</span> : (
                      <input aria-label={`Band ${i + 1} up to km`} inputMode="numeric" className={input} value={b.upToKm}
                        onChange={(e) => setBands((bs) => bs.map((x, j) => (j === i ? { ...x, upToKm: e.target.value } : x)))} />
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Band ${i + 1} rate per kg`} inputMode="decimal" className={input} value={b.ratePerKg}
                      onChange={(e) => setBands((bs) => bs.map((x, j) => (j === i ? { ...x, ratePerKg: e.target.value } : x)))} />
                  </td>
                  <td className="py-1">
                    {!last && bands.length > 1 && (
                      <button type="button" className="text-xs text-red-600 underline" onClick={() => setBands((bs) => bs.filter((_, j) => j !== i))}>Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {bands.length < 10 && (
          <button type="button" className="mt-2 text-sm text-blue-700 underline"
            onClick={() => setBands((bs) => [...bs.slice(0, -1), { upToKm: '', ratePerKg: bs[bs.length - 1]?.ratePerKg || '16' }, bs[bs.length - 1]])}>
            Add a band
          </button>
        )}
      </fieldset>

      {save.error && <p className="mb-3 text-sm text-red-600" role="alert">{(save.error as Error).message}</p>}
      {save.isSuccess && <p className="mb-3 text-sm text-green-700">Saved. Checkout uses the new rates straight away.</p>}
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="mb-10 bg-blue-600 text-white rounded-lg px-5 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save rates'}
      </button>

      <section className={box}>
        <h2 className="text-xl font-semibold mb-1">Remote area PINs ({config.data?.remotePinCount ?? 0})</h2>
        <p className="text-sm text-gray-600 mb-4">
          Paste the courier&apos;s ODA list — any text with 6-digit PIN codes (CSV, one per line…). These PINs get the
          Remote area fee. Adding a PIN twice is harmless.
        </p>
        <textarea
          className={`${input} h-32 font-mono text-sm`}
          placeholder="735101, 735102…"
          value={pinText}
          onChange={(e) => setPinText(e.target.value)}
        />
        <input className={`${input} mt-2`} placeholder="Note (optional, e.g. Delhivery ODA list Nov 2026)" value={pinNote} onChange={(e) => setPinNote(e.target.value)} maxLength={120} />
        <div className="mt-3 flex gap-3">
          <button onClick={() => addPins.mutate()} disabled={!pinText.trim() || addPins.isPending} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            Add to list
          </button>
          <button onClick={() => removePins.mutate()} disabled={!pinText.trim() || removePins.isPending} className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            Remove from list
          </button>
        </div>
        {pinMsg && <p className="mt-2 text-sm text-green-700">{pinMsg}</p>}
        {(addPins.error || removePins.error) && (
          <p className="mt-2 text-sm text-red-600" role="alert">{((addPins.error || removePins.error) as Error).message}</p>
        )}

        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="pin-search">Search the list</label>
          <input id="pin-search" className={`${input} max-w-xs`} inputMode="numeric" placeholder="e.g. 7351" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <ul className="mt-3 grid grid-cols-3 gap-1 text-sm font-mono sm:grid-cols-6">
            {(pins.data?.pins || []).map((p) => <li key={p.pin} title={p.note || undefined}>{p.pin}</li>)}
          </ul>
          {pins.data?.nextCursor && <p className="mt-2 text-xs text-gray-500">Showing the first 100 — type more digits to narrow it down.</p>}
        </div>
      </section>
    </div>
  );
}
