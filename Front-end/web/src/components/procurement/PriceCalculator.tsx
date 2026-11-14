'use client';

import { useState } from 'react';
import { AlertTriangle, Calculator, ChevronDown } from 'lucide-react';
import {
  calculateForward, calculateReverse, forwardProblems, GST_RATES, parsePercent, parseRupees, percent, reverseProblems, rupees,
  type ForwardInput, type PriceBy, type ReverseInput, type Step,
} from './pricing';

/**
 * Procurement's price calculator. Runs entirely in the browser: nothing is sent
 * or saved, and no catalogue price changes. All maths lives in ./pricing.ts.
 *
 * `onUse` (the enquiry form): offers "Use as target price" with a per-unit price
 * before GST — the supplier price (forward) or the most we can pay (reverse).
 */
export default function PriceCalculator({ onUse, useLabel = 'Use as target price', initialCost = '', initialFreight = '' }: {
  onUse?: (rupeesExGst: string) => void;
  useLabel?: string;
  initialCost?: string;
  /** Rupees, e.g. from the shipping calculator. */
  initialFreight?: string;
}) {
  const [mode, setMode] = useState<'forward' | 'reverse'>('forward');
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Calculator mode" className="flex flex-wrap gap-2">
        {([['forward', 'Selling price from cost'], ['reverse', 'Most we can pay']] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${mode === key ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'forward' ? <Forward onUse={onUse} useLabel={useLabel} initialCost={initialCost} initialFreight={initialFreight} /> : <Reverse onUse={onUse} useLabel={useLabel} initialFreight={initialFreight} />}
      <p className="text-xs text-gray-500">
        Worked out on this page only — nothing is saved and no website price changes. Assumes we claim the GST we pay the supplier
        (untick it if we can&apos;t), import duty is on cost + freight, and the customer discount comes off the price with GST.
      </p>
    </div>
  );
}

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

function Field({ id, text, value, onChange, prefix, suffix, placeholder, error }: {
  id: string; text: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; placeholder?: string; error?: string;
}) {
  return (
    <div>
      <label className={label} htmlFor={id}>{text}</label>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">{prefix}</span>}
        <input id={id} className={`${input} ${prefix ? 'pl-7' : ''} ${suffix ? 'pr-8' : ''} ${error ? 'border-red-400' : ''}`}
          inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder}
          aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">{suffix}</span>}
      </div>
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function GstSelect({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className={label} htmlFor={id}>GST rate</label>
      <select id={id} className={input} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
      </select>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Empty → 0 for optional amounts; NaN stays NaN so the problem shows. */
const opt = (v: number | null) => (v == null ? 0 : v);
const errFor = (problems: { field: string; message: string }[], field: string, touched: boolean) =>
  (touched ? problems.find((p) => p.field === field)?.message : undefined);

function Working({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
        Show the working <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="divide-y divide-gray-100 border-t border-gray-200 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
              <span className="text-gray-800">{i + 1}. {s.label}<span className="block text-xs text-gray-500">{s.working}</span></span>
              <span className="font-mono tabular-nums text-gray-900">{rupees(s.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Stat({ title, value, sub, tone = 'plain' }: { title: string; value: string; sub?: string; tone?: 'plain' | 'good' | 'bad' | 'main' }) {
  const toneCls = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : 'text-gray-900';
  return (
    <div className={`rounded-lg border p-3 ${tone === 'main' ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <ul className="space-y-1">
      {list.map((w) => (
        <li key={w} role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
        </li>
      ))}
    </ul>
  );
}

const toRupeesText = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

function Forward({ onUse, useLabel, initialCost, initialFreight }: { onUse?: (r: string) => void; useLabel: string; initialCost: string; initialFreight: string }) {
  const [v, setV] = useState({
    cost: initialCost, costIncludesGst: false, gstRate: 18, claimGstCredit: true,
    freight: initialFreight, duty: '', other: '', priceBy: 'margin' as PriceBy, margin: '25', markup: '30', sellingPrice: '', mrp: '', discount: '',
  });
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((o) => ({ ...o, [k]: x }));
  const parsed: ForwardInput = {
    cost: parseRupees(v.cost) as number, costIncludesGst: v.costIncludesGst, gstRate: v.gstRate, claimGstCredit: v.claimGstCredit,
    freight: opt(parseRupees(v.freight)), dutyBp: opt(parsePercent(v.duty)), other: opt(parseRupees(v.other)),
    priceBy: v.priceBy, marginBp: opt(parsePercent(v.margin)), markupBp: opt(parsePercent(v.markup)),
    sellingPrice: parseRupees(v.sellingPrice) as number, mrp: parseRupees(v.mrp), discountBp: opt(parsePercent(v.discount)),
  };
  const problems = forwardProblems(parsed);
  const r = problems.length ? null : calculateForward(parsed);
  const touched = v.cost !== '';
  const e = (f: string) => errFor(problems, f, touched || f !== 'cost');

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-gray-900">Buying</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pc-cost" text="Supplier price (per unit)" prefix="₹" value={v.cost} onChange={set('cost')} placeholder="1000" error={e('cost')} />
            <GstSelect id="pc-gst" value={v.gstRate} onChange={set('gstRate')} />
          </div>
          <Check checked={v.costIncludesGst} onChange={set('costIncludesGst')}>Supplier price already includes GST</Check>
          <Check checked={v.claimGstCredit} onChange={set('claimGstCredit')}>We claim the GST paid as input credit</Check>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="pc-freight" text="Freight" prefix="₹" value={v.freight} onChange={set('freight')} placeholder="0" error={e('freight')} />
            <Field id="pc-duty" text="Import duty" suffix="%" value={v.duty} onChange={set('duty')} placeholder="0" error={e('dutyBp')} />
            <Field id="pc-other" text="Other charges" prefix="₹" value={v.other} onChange={set('other')} placeholder="0" error={e('other')} />
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-gray-900">Selling</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Price by">
            {([['margin', 'Margin %'], ['markup', 'Markup %'], ['price', 'Fixed price']] as const).map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={v.priceBy === k} onClick={() => set('priceBy')(k)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${v.priceBy === k ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {v.priceBy === 'margin' && <Field id="pc-margin" text="Target margin" suffix="%" value={v.margin} onChange={set('margin')} error={e('marginBp')} />}
            {v.priceBy === 'markup' && <Field id="pc-markup" text="Markup on cost" suffix="%" value={v.markup} onChange={set('markup')} error={e('markupBp')} />}
            {v.priceBy === 'price' && <Field id="pc-price" text="Selling price incl. GST" prefix="₹" value={v.sellingPrice} onChange={set('sellingPrice')} error={e('sellingPrice')} />}
            <Field id="pc-mrp" text="MRP (optional)" prefix="₹" value={v.mrp} onChange={set('mrp')} error={e('mrp')} />
            <Field id="pc-discount" text="Customer discount" suffix="%" value={v.discount} onChange={set('discount')} placeholder="0" error={e('discountBp')} />
          </div>
        </fieldset>
      </div>

      <div className="space-y-3" aria-live="polite">
        {!r ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
            <Calculator className="h-5 w-5" /> {touched ? problems[0]?.message : 'Enter the supplier price to see the numbers.'}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat title="Customer pays" value={rupees(r.finalPrice)} sub={`incl. GST ${rupees(r.finalGst)}`} tone="main" />
              <Stat title="Profit / unit" value={rupees(r.profit)} sub={r.marginBp == null ? undefined : `${percent(r.marginBp)} margin · ${percent(r.markupBp ?? 0)} markup`} tone={r.profit > 0 ? 'good' : 'bad'} />
              <Stat title="Landed cost" value={rupees(r.landed)} sub="per unit, our real cost" />
              <Stat title="Break-even" value={rupees(r.breakEven)} sub={r.maxDiscountBp == null ? 'incl. GST' : `incl. GST · max discount ${percent(r.maxDiscountBp)}`} />
              <Stat title="Selling price" value={rupees(r.listPrice)} sub={`${rupees(r.listExGst)} + GST ${rupees(r.listGst)}`} />
              <Stat title="Discount" value={rupees(r.discount)} sub={r.mrpDiscountBp != null ? `${percent(r.mrpDiscountBp)} below MRP` : undefined} />
              <Stat title="GST to pay govt." value={rupees(r.gstPayable)} sub={v.claimGstCredit ? `after ${rupees(r.purchaseGst)} credit` : 'no credit claimed'} />
              <Stat title="Supplier price ex-GST" value={rupees(r.costExGst)} sub={`GST paid ${rupees(r.purchaseGst)}`} />
            </div>
            <Warnings list={r.warnings} />
            <Working steps={r.steps} />
            {onUse && (
              <button type="button" onClick={() => onUse(toRupeesText(r.costExGst))}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                {useLabel}: {rupees(r.costExGst)} + GST
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Reverse({ onUse, useLabel, initialFreight }: { onUse?: (r: string) => void; useLabel: string; initialFreight: string }) {
  const [v, setV] = useState({ sellingPrice: '', gstRate: 18, claimGstCredit: true, margin: '25', freight: initialFreight, duty: '', other: '' });
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((o) => ({ ...o, [k]: x }));
  const parsed: ReverseInput = {
    sellingPrice: parseRupees(v.sellingPrice) as number, gstRate: v.gstRate, claimGstCredit: v.claimGstCredit,
    marginBp: opt(parsePercent(v.margin)), freight: opt(parseRupees(v.freight)), dutyBp: opt(parsePercent(v.duty)), other: opt(parseRupees(v.other)),
  };
  const problems = reverseProblems(parsed);
  const r = problems.length ? null : calculateReverse(parsed);
  const touched = v.sellingPrice !== '';
  const e = (f: string) => errFor(problems, f, touched || f !== 'sellingPrice');

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rv-price" text="Customer pays (incl. GST)" prefix="₹" value={v.sellingPrice} onChange={set('sellingPrice')} placeholder="1499" error={e('sellingPrice')} />
          <GstSelect id="rv-gst" value={v.gstRate} onChange={set('gstRate')} />
          <Field id="rv-margin" text="Margin we want" suffix="%" value={v.margin} onChange={set('margin')} error={e('marginBp')} />
        </div>
        <Check checked={v.claimGstCredit} onChange={set('claimGstCredit')}>We claim the GST paid as input credit</Check>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="rv-freight" text="Freight" prefix="₹" value={v.freight} onChange={set('freight')} placeholder="0" error={e('freight')} />
          <Field id="rv-duty" text="Import duty" suffix="%" value={v.duty} onChange={set('duty')} placeholder="0" error={e('dutyBp')} />
          <Field id="rv-other" text="Other charges" prefix="₹" value={v.other} onChange={set('other')} placeholder="0" error={e('other')} />
        </div>
      </div>
      <div className="space-y-3" aria-live="polite">
        {!r ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
            <Calculator className="h-5 w-5" /> {touched ? problems[0]?.message : 'Enter the price the customer will pay.'}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat title="Pay supplier at most" value={rupees(r.maxBuyExGst)} sub={`+ GST = ${rupees(r.maxBuyInclGst)}`} tone="main" />
              <Stat title="Profit / unit" value={rupees(r.profit)} sub="at that buy price" tone={r.profit > 0 ? 'good' : 'bad'} />
              <Stat title="Selling price ex-GST" value={rupees(r.sellingExGst)} sub={`GST ${rupees(r.sellingGst)}`} />
              <Stat title="Landed cost limit" value={rupees(r.maxLanded)} />
            </div>
            <Warnings list={r.warnings} />
            <Working steps={r.steps} />
            {onUse && r.maxBuyExGst > 0 && (
              <button type="button" onClick={() => onUse(toRupeesText(r.maxBuyExGst))}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                {useLabel}: {rupees(r.maxBuyExGst)} + GST
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
