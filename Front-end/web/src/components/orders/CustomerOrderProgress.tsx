'use client';

import { Check } from 'lucide-react';
import { windowDates } from '@/lib/deliveryWindow';

/**
 * The customer's order timeline: Placed → Preparing → Packed → Shipped → Delivered,
 * with the date of every step, the step we are working on now, and the delivery
 * estimate. "Nothing Extra" (2026-11-23): the customer should see where the order is
 * at every stage without having to ask.
 *
 * Everything shown comes from the server (GET /orders/:id → `progress`, built by
 * Back-end/server/utils/customerOrderProgress.js from real order state) — the page
 * never guesses a step or a date. The same steps drive the progress emails.
 */
export type ProgressStepKey = 'placed' | 'preparing' | 'packed' | 'shipped' | 'delivered';

export interface CustomerProgress {
  current: ProgressStepKey;
  onHold: boolean;
  steps: Array<{ key: ProgressStepKey; at: string | null; done: boolean }>;
  parcels: { total: number; shipped: number; delivered: number };
  estimate:
    | null
    | { kind: 'courier'; day: string }
    | { kind: 'window'; from: string; minDays: number; maxDays: number; heavy: boolean };
}

const LABEL: Record<ProgressStepKey, string> = {
  placed: 'Placed',
  preparing: 'Preparing',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

/** What we are doing right now, in one line — keyed by the step being worked on. */
const NOW: Record<ProgressStepKey, string> = {
  placed: 'Your order is placed.',
  preparing: 'Our team is confirming your item.',
  packed: 'Your item is confirmed — we’re preparing it for dispatch.',
  shipped: 'Packed and waiting for the courier.',
  delivered: 'On its way to you.',
};

const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const shortDay = (iso: string) => dayFmt.format(new Date(iso)).replace(',', '');
/** 'YYYY-MM-DD' (an India calendar day) → "Fri 4 Dec". */
const calendarDay = (day: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`)).replace(',', '');

function estimateText(estimate: CustomerProgress['estimate']): string | null {
  if (!estimate) return null;
  if (estimate.kind === 'courier') return `Expected by ${calendarDay(estimate.day)}`;
  const from = Date.parse(estimate.from);
  if (!Number.isFinite(from)) return null;
  return `Expected delivery: ${windowDates(estimate, from)}`;
}

export default function CustomerOrderProgress({ progress }: { progress: CustomerProgress }) {
  const delivered = progress.steps[progress.steps.length - 1]?.done === true;
  const partly = !delivered && progress.parcels.shipped > 0 && progress.parcels.total > progress.parcels.shipped;
  const headline = delivered
    ? 'Delivered. We hope you love it.'
    : progress.onHold
      ? 'One item needs a quick word with you — our team will be in touch.'
      : partly
        ? 'Part of your order is on its way; the rest follows separately.'
        : NOW[progress.current];
  const estimate = delivered ? null : estimateText(progress.estimate);

  return (
    <section aria-label="Order progress" className="w-full">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between mb-5">
        <p className="font-display text-[15px] font-semibold text-ink flex items-center gap-2" data-testid="progress-headline">
          {!delivered && (
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gold" />
            </span>
          )}
          {headline}
        </p>
        {estimate && (
          <p className="font-display text-sm text-ink-muted" data-testid="progress-estimate">{estimate}</p>
        )}
      </div>

      <ol className="flex flex-col gap-4 sm:flex-row sm:gap-0">
        {progress.steps.map((step, i) => {
          const working = !delivered && step.key === progress.current;
          const last = i === progress.steps.length - 1;
          return (
            <li
              key={step.key}
              className="relative flex sm:flex-1 sm:flex-col sm:items-center gap-3 sm:gap-2"
              aria-current={working ? 'step' : undefined}
              data-state={step.done ? 'done' : working ? 'working' : 'todo'}
            >
              {/* Connector to the next step: down on a phone, across on wider screens. */}
              {!last && (
                <span
                  aria-hidden="true"
                  className={`absolute left-[11px] top-6 h-[calc(100%-0.25rem)] w-0.5 sm:left-1/2 sm:top-[11px] sm:h-0.5 sm:w-full ${
                    progress.steps[i + 1]?.done ? 'bg-ink' : 'bg-hairline'
                  }`}
                />
              )}
              <span
                aria-hidden="true"
                className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                  step.done
                    ? 'bg-ink border-ink text-white'
                    : working
                      ? 'bg-obsidian-raised border-gold ring-4 ring-gold/20'
                      : 'bg-obsidian-raised border-hairline'
                }`}
              >
                {step.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                {working && <span className="h-2 w-2 rounded-full bg-gold" />}
              </span>
              <span className="flex flex-col sm:items-center">
                <span className={`font-display text-sm ${step.done || working ? 'text-ink font-semibold' : 'text-ink-muted'}`}>
                  {LABEL[step.key]}
                </span>
                <span className={`text-xs ${working ? 'text-gold font-semibold' : 'text-ink-muted'}`}>
                  {step.done && step.at ? shortDay(step.at) : working ? 'In progress' : ' '}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {!delivered && (
        <p className="mt-5 text-xs text-ink-muted font-display">
          We’ll email you at every step, so you always know where your order is.
        </p>
      )}
    </section>
  );
}
