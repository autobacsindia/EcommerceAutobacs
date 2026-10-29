'use client';

import { Check } from 'lucide-react';
import { formatDateTimeIST } from '@/lib/datetime';
import { rupees } from '@/components/staff/sales/types';
import type { WorkOrder } from '@/components/staff/work/types';
import { formatEtaDay } from '@/components/staff/work/ParcelEta';
import { buildJourney, type JourneyStep, type StepKey } from './journeySteps';

/**
 * The order's journey as a left-to-right tracker (top to bottom on a phone), one
 * row per product, with who moved it and when under every step. Read-only: the
 * actions stay where they are (team panel, admin order page).
 *
 * Step colours follow the team panel's stage pills (staff/work/types.ts
 * STAGE_TONE) so the same stage reads the same everywhere.
 */
const DOT: Record<StepKey, string> = {
  paid: 'bg-sky-600',
  stock_check: 'bg-orange-500',
  to_ship: 'bg-yellow-500',
  own_stock: 'bg-teal-600',
  payment_pending: 'bg-red-600',
  with_supplier: 'bg-amber-600',
  shipped: 'bg-green-600',
  // Literal: panel.css lightens green-800 in the dark theme, under a white tick.
  delivered: 'bg-[#166534]',
  customer_decision: 'bg-rose-600',
  accounts_approval: 'bg-purple-600',
  cancelled: 'bg-gray-600',
};

const STATE_TEXT: Record<JourneyStep['state'], string> = {
  done: 'Done',
  current: 'Now',
  upcoming: 'Not yet',
  skipped: 'Skipped',
};

function Step({ s, last }: { s: JourneyStep; last: boolean }) {
  const reached = s.state === 'done' || s.state === 'current';
  return (
    <li
      className="relative flex gap-3 pb-4 sm:min-w-0 sm:flex-1 sm:flex-col sm:gap-2 sm:pb-0 sm:pr-3"
      aria-current={s.state === 'current' ? 'step' : undefined}
    >
      {/* The connector to the next step: down on a phone, across from sm. */}
      {!last && (
        <span
          aria-hidden="true"
          className={`absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-0.5 sm:left-6 sm:top-[11px] sm:h-0.5 sm:w-[calc(100%-1.5rem)] ${
            s.state === 'done' || s.state === 'skipped' ? 'bg-gray-400' : 'bg-gray-200'
          }`}
        />
      )}
      <span
        aria-hidden="true"
        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#fff] ${
          reached ? DOT[s.key] : 'border-2 border-dashed border-gray-300 bg-white'
        } ${s.state === 'current' ? 'ring-4 ring-gray-200' : ''}`}
      >
        {s.state === 'done' && <Check className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${reached ? 'text-gray-900' : 'text-gray-500'}`}>
          {s.label}
          <span className="sr-only"> — {STATE_TEXT[s.state]}</span>
        </p>
        {s.state === 'current' && <p className="text-xs font-semibold text-gray-700">Now</p>}
        {s.state === 'skipped' && <p className="text-xs text-gray-500">Skipped</p>}
        {s.at && (
          <p className="text-xs text-gray-600">
            {formatDateTimeIST(s.at)}
            {s.by && <> · {s.by}{s.team ? ` (${s.team})` : ''}</>}
          </p>
        )}
        {s.note && <p className="break-words text-xs text-gray-500">{s.note}</p>}
      </div>
    </li>
  );
}

function Track({ steps, label }: { steps: JourneyStep[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col sm:flex-row">
      {steps.map((s, i) => <Step key={s.key} s={s} last={i === steps.length - 1} />)}
    </ol>
  );
}

/**
 * `showFacts`: the summary strip (customer, seller, total…). The team panel
 * already lays those out around the tracker, so it turns the strip off.
 */
export default function OrderJourney({ order, showFacts = true }: { order: WorkOrder; showFacts?: boolean }) {
  const lines = buildJourney(order);
  const dispatched = order.parcels.filter((p) => p.status !== 'packed').length;
  const delivered = order.parcels.filter((p) => p.status === 'delivered').length;
  const facts: [string, string][] = [
    ['Customer', order.customer.name || '—'],
    ['Sold by', order.soldBy || '—'],
    ['Total', rupees(order.totalAmount)],
    ['Paid', order.enteredAt ? formatDateTimeIST(order.enteredAt) : 'Not yet'],
    ['Parcels', order.parcels.length ? `${dispatched} dispatched · ${delivered} delivered` : 'None yet'],
  ];
  // The soonest expected delivery among parcels still on their way (set by operations).
  const nextEta = order.parcels
    .filter((p) => p.status !== 'delivered' && p.eta?.date)
    .map((p) => p.eta!.date)
    .sort()[0];
  if (nextEta) facts.push(['Expected delivery', formatEtaDay(nextEta)]);
  if (order.cancellations.length) facts.push(['Cancelled / refunded', `${order.cancellations.length}`]);

  return (
    <section aria-labelledby="order-journey" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 id="order-journey" className="text-base font-semibold text-gray-900">Order journey</h2>
      {showFacts && <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-6">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-gray-500">{k}</dt>
            <dd className="truncate font-medium text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>}

      {!order.inWorkflow ? (
        <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          The journey starts once the customer has paid.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {lines.map((l) => (
            <div key={l.itemId}>
              {lines.length > 1 && (
                <p className="mb-2 text-sm font-medium text-gray-800">{l.name} × {l.quantity}</p>
              )}
              <Track steps={l.steps} label={`Journey of ${l.name}`} />
              {l.branch && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-800">Out of stock / refund</p>
                  <Track steps={l.branch} label={`Refund path of ${l.name}`} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
