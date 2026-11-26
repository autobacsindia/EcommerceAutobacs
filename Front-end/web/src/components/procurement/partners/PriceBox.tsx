'use client';

import { AlertTriangle, Ban } from 'lucide-react';
import { marginOf, paiseToRupees, pct, rupees, suggestPrice, type MarginRule } from './api';

/**
 * The price box on a review screen: what the supplier charges, the GST, the
 * margin our selling price gives, the suggested price, and the floor warning.
 * Display only — the server re-checks the price and refuses anything below cost.
 *
 * `price` is what procurement typed (whole rupees incl. GST); the parent owns it.
 */
export type PriceBoxValue = { price: string; override: boolean; reason: string };

export function priceState(costPaise: number, gstPct: number, rule: MarginRule, price: string) {
  const n = Number(price);
  const valid = Number.isInteger(n) && n >= 1;
  const marginBp = valid ? marginOf(costPaise, gstPct, n) : null;
  return {
    valid,
    price: valid ? n : null,
    marginBp,
    belowCost: marginBp != null && marginBp < 0,
    belowFloor: marginBp != null && marginBp < rule.floorBp,
    suggested: suggestPrice(costPaise, gstPct, rule.targetBp),
  };
}

/** May this price be sent? Below cost never; below floor only with the box ticked and a reason. */
export const priceSendable = (s: ReturnType<typeof priceState>, v: PriceBoxValue) =>
  s.valid && !s.belowCost && (!s.belowFloor || (v.override && v.reason.trim().length >= 5));

export default function PriceBox({
  costPaise, gstPct, rule, value, onChange, label = 'Selling price on the website', currentPrice = null,
}: {
  costPaise: number;
  gstPct: number;
  rule: MarginRule;
  value: PriceBoxValue;
  onChange: (v: PriceBoxValue) => void;
  label?: string;
  currentPrice?: number | null;
}) {
  const s = priceState(costPaise, gstPct, rule, value.price);
  const costIncl = Math.round((costPaise * (100 + gstPct)) / 100);
  const set = (patch: Partial<PriceBoxValue>) => onChange({ ...value, ...patch });

  return (
    <section aria-label="Price" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Supplier&apos;s price (without GST)</dt>
        <dd className="text-right font-medium text-gray-900" data-testid="cost">{paiseToRupees(costPaise)}</dd>
        <dt className="text-gray-500">GST</dt>
        <dd className="text-right text-gray-900">{gstPct}%</dd>
        <dt className="text-gray-500">Supplier&apos;s price with GST</dt>
        <dd className="text-right text-gray-900">{paiseToRupees(costIncl)}</dd>
        {currentPrice != null && (<>
          <dt className="text-gray-500">Price on the website now</dt>
          <dd className="text-right text-gray-900">{rupees(currentPrice)}</dd>
        </>)}
        <dt className="text-gray-500">Our margin rule</dt>
        <dd className="text-right text-gray-900">aim {pct(rule.targetBp)}, never below {pct(rule.floorBp)}</dd>
      </dl>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[10rem] flex-1 text-sm">
          <span className="font-medium text-gray-800">{label} (₹, with GST)</span>
          <input
            inputMode="numeric" value={value.price} placeholder={String(s.suggested)}
            onChange={(e) => set({ price: e.target.value.replace(/[^\d]/g, '') })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <button type="button" onClick={() => set({ price: String(s.suggested) })}
          className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100">
          Use suggested {rupees(s.suggested)}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Suggested = the supplier&apos;s price + {pct(rule.targetBp)} margin + GST, rounded up to the rupee.
        Example: ₹1,800 + 18% GST at 30% → ₹3,035.
      </p>

      {s.marginBp != null && (
        <p className="text-sm" data-testid="margin">
          Margin at {rupees(s.price!)}: <strong className={s.belowFloor ? 'text-red-700' : 'text-green-700'}>{pct(s.marginBp)}</strong>
        </p>
      )}

      {s.belowCost && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" /> This is below what the supplier charges us. It cannot be saved — raise the price.
        </p>
      )}
      {!s.belowCost && s.belowFloor && (
        <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Below our lowest allowed margin ({pct(rule.floorBp)}).</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.override} onChange={(e) => set({ override: e.target.checked })} />
            Sell below the floor anyway
          </label>
          {value.override && (
            <label className="block">
              <span>Why? (kept in the record)</span>
              <input value={value.reason} onChange={(e) => set({ reason: e.target.value })} maxLength={300}
                placeholder="e.g. match Amazon price for Diwali"
                className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" />
            </label>
          )}
        </div>
      )}
    </section>
  );
}
