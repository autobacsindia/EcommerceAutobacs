'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lock, Star } from 'lucide-react';
import { useMyIncentives, useMyIncentiveOrders, useMyIncentiveRatings } from '@/hooks/queries/useIncentives';
import {
  currentMonthIST, shiftMonth, monthLabel, points, rupees, describeMyLine, ratingStatus,
  type MyMonth, type MyOrder, type MyOrderStatus, type MyPendingOrder,
} from '@/lib/incentives';

/**
 * "My Roav Points" — the logged-in salesperson's own month, the same figures
 * the admin sees for them (every number comes from the server; this screen only
 * formats). Read-only: no lock / approve / recompute here.
 */
const errorText = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '—');
const pts2 = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const STATUS: Record<MyOrderStatus, { text: string; cls: string }> = {
  counted: { text: 'Counted', cls: 'bg-green-50 text-green-700' },
  partly_reversed: { text: 'Partly reversed', cls: 'bg-amber-50 text-amber-800' },
  reversed: { text: 'Reversed', cls: 'bg-red-50 text-red-700' },
  pending: { text: 'Waiting for payment check', cls: 'bg-gray-100 text-gray-600' },
};

const MONTH_STATUS: Record<string, string> = {
  open: 'Month in progress — figures are an estimate until month-end',
  locked: 'Month closed — final figures, waiting for approval',
  approved: 'Month approved — these are your final figures',
};

export default function MyRoavPoints() {
  const [month, setMonth] = useState(() => currentMonthIST());
  const isCurrent = month >= currentMonthIST();
  const { data, isLoading, error } = useMyIncentives(month);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Roav Points</h1>
          <p className="text-sm text-gray-500">Your points from verified-paid orders, your slab and your incentive.</p>
        </div>
        <div className="flex items-center gap-1">
          <button aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-36 text-center font-semibold text-gray-900">{monthLabel(month)}</span>
          <button aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorText(error, 'Could not load your points. Please try again.')}</p>
      ) : isLoading || !data ? (
        <SummarySkeleton />
      ) : (
        <>
          <p className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${data.status === 'open' ? 'bg-blue-50 text-blue-800' : 'bg-green-50 text-green-800'}`}>
            {data.status !== 'open' && <Lock className="h-4 w-4" />}{MONTH_STATUS[data.status]}
          </p>
          <Summary data={data} />
          <RatingsBox data={data} month={month} />
        </>
      )}

      {!error && <OrdersTable key={month} month={month} />}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div aria-label="Loading your points" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function Summary({ data }: { data: MyMonth }) {
  const s = data.statement;
  const slab = data.slabs.find((x) => x.name === data.slab);
  const next = data.next;
  const prevMin = slab?.minPoints ?? 0;
  const progress = next ? Math.max(0, Math.min(100, ((data.points - prevMin) / (next.minPoints - prevMin)) * 100)) : 100;
  const returnRate = s ? Math.round(s.returnRate * 10) / 10 : 0; // the server sends a percentage
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Points" value={points(data.points)} sub={s && s.finalPoints !== s.ledgerPoints ? `${points(s.ledgerPoints)} before multipliers` : undefined} />
        <Card label="Slab" value={data.slab || 'Below first slab'} sub={slab ? `₹${slab.ratePerPoint} per point` : `Reach ${points(data.slabs[0]?.minPoints || 0)} pts to start earning`} />
        <Card label={data.status === 'open' ? 'Estimated incentive' : 'Incentive'} value={rupees(data.payout)} sub={data.status === 'open' ? 'Estimate until month-end' : 'Final for this month'} />
        <Card label="Paid-order bonus" value={`${data.bonusOrders} order${data.bonusOrders === 1 ? '' : 's'}`} sub={`+${points(data.policy.perOrderBonus)} pts each, orders from ${rupees(data.policy.perOrderBonusMinValue)} ex-GST`} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <span className="font-medium text-gray-800">{next ? `${points(next.pointsToGo)} pts to ${next.name}` : 'You are in the top slab'}</span>
          {next && <span className="text-gray-500">{points(data.points)} / {points(next.minPoints)}</span>}
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-label="Progress to the next slab" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Returns check</p>
          <p className="mt-1 text-gray-800">
            {s ? `${s.returnedOrders} of ${s.orders} order${s.orders === 1 ? '' : 's'} returned (${returnRate}%)` : 'No orders yet'}
            {' — '}
            {s && s.returnFactor !== 1 ? <b className="text-red-700">×{s.returnFactor}</b> : <span className="text-green-700">no reduction</span>}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">Above {data.policy.returnRateThresholdPercent}% returns, points are multiplied by ×{data.policy.returnPenaltyMultiplier}.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Rating multiplier</p>
          <p className="mt-1 text-gray-800">
            {ratingStatus(s?.ratingCount || 0, s?.ratingAvg ?? null, data.policy.rating).label}
            {s && s.ratingFactor !== 1 && <> — applied <b>×{s.ratingFactor}</b></>}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            With {data.policy.rating.minCount}+ ratings: average {data.policy.rating.highAvg}★ or more ×{data.policy.rating.highMultiplier}, below {data.policy.rating.lowAvg}★ ×{data.policy.rating.lowMultiplier}.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} out of 5 stars`} className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`h-3.5 w-3.5 ${i <= n ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />)}
    </span>
  );
}

function RatingsBox({ data, month }: { data: MyMonth; month: string }) {
  const s = data.statement;
  const { data: list } = useMyIncentiveRatings(month);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="my-ratings">
      <h2 id="my-ratings" className="text-sm font-semibold text-gray-900">Customer ratings this month</h2>
      <p className="mt-1 text-sm text-gray-700">
        {s?.ratingCount ? <>{s.ratingCount} rating{s.ratingCount === 1 ? '' : 's'}, average <b>{s.ratingAvg}★</b></> : 'No ratings counted yet.'}
      </p>
      {data.ratingsExcluded > 0 && (
        <p className="mt-0.5 text-xs text-gray-500">{data.ratingsExcluded} more not counted — sent from the same network as the rating link.</p>
      )}
      {list?.visible && list.ratings.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {list.ratings.map((r, i) => (
            <li key={i} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Stars n={r.stars} />
                <span className="font-mono text-xs text-gray-500">{r.orderNumber}</span>
                <span className="text-gray-700">{r.customerName}</span>
                {!r.counted && <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600">not counted — same network</span>}
              </div>
              {r.comment && <p className="mt-0.5 text-gray-600">“{r.comment}”</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OrdersTable({ month }: { month: string }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [open, setOpen] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  const { data, isLoading, error } = useMyIncentiveOrders(month, cursor);
  const showRating = !!data?.ratingDetails;
  const cols = showRating ? 9 : 8;

  return (
    <section className="space-y-2" aria-labelledby="my-orders">
      <h2 id="my-orders" className="text-lg font-semibold text-gray-900">Orders</h2>
      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-600">{errorText(error, 'Could not load your orders.')}</p>
      ) : isLoading || !data ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">Loading orders…</p>
      ) : data.orders.length === 0 && data.pending.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">No orders with points this month yet.</p>
      ) : (
        <>
          {/* Phones: one card per order. */}
          <ul className="space-y-2 md:hidden" aria-label="Orders">
            {data.pending.map((p) => <PendingCard key={p.order} p={p} />)}
            {data.orders.map((o) => (
              <OrderCard key={o.order} o={o} month={month} showRating={showRating} open={open === o.order} onToggle={() => setOpen(open === o.order ? null : o.order)} />
            ))}
          </ul>
          {/* Wider screens: the table. */}
          <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-3">Order</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3 text-right">Value ex-GST</th>
                  <th className="px-3 py-3 text-right">Discount</th>
                  <th className="px-3 py-3 text-right">Points</th>
                  <th className="px-3 py-3 text-right">Bonus</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3">Status</th>
                  {showRating && <th className="px-3 py-3">Rating</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.pending.map((p) => <PendingRow key={p.order} p={p} showRating={showRating} />)}
                {data.orders.map((o) => (
                  <OrderRow key={o.order} o={o} month={month} showRating={showRating} cols={cols} open={open === o.order} onToggle={() => setOpen(open === o.order ? null : o.order)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-xs text-gray-500">Points per order are before the month&apos;s return and rating multipliers. Tap an order to see each line.</p>
      {(cursors.length > 1 || data?.nextCursor) && (
        <div className="flex gap-2">
          {cursors.length > 1 && <button onClick={() => { setCursors(cursors.slice(0, -1)); setOpen(null); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Newer</button>}
          {data?.nextCursor && <button onClick={() => { setCursors([...cursors, data.nextCursor]); setOpen(null); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Older</button>}
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: MyOrderStatus }) {
  const s = STATUS[status];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>;
}

function PendingRow({ p, showRating }: { p: MyPendingOrder; showRating: boolean }) {
  return (
    <tr className="text-gray-500">
      <td className="px-3 py-3"><span className="font-mono text-gray-700">{p.orderNumber}</span><span className="block text-xs">{fmtDate(p.date)}</span></td>
      <td className="px-3 py-3">{p.customerName}</td>
      <td colSpan={5} className="px-3 py-3 text-right text-xs">Points appear once the payment is verified</td>
      <td className="px-3 py-3"><StatusPill status="pending" /></td>
      {showRating && <td />}
    </tr>
  );
}

function OrderRow({ o, month, showRating, cols, open, onToggle }: { o: MyOrder; month: string; showRating: boolean; cols: number; open: boolean; onToggle: () => void }) {
  return (
    <Fragment>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={onToggle} aria-expanded={open}>
        <td className="px-3 py-3">
          <span className="inline-flex items-center gap-1 font-mono text-gray-900">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{o.orderNumber}
          </span>
          <span className="block text-xs text-gray-500">{fmtDate(o.date)}</span>
        </td>
        <td className="px-3 py-3 text-gray-800">
          {o.customerName || '—'}
          {(o.specialSourcing || o.isB2B) && (
            <span className="block text-xs text-amber-700">{[o.isB2B ? 'B2B' : null, o.specialSourcing ? `Special sourcing (keeps ${Math.round((o.sourcingKeep ?? 0.75) * 100)}%)` : null].filter(Boolean).join(' · ')}</span>
          )}
        </td>
        <td className="px-3 py-3 text-right">{o.valueExGst != null ? rupees(o.valueExGst) : '—'}</td>
        <td className="px-3 py-3 text-right">{o.discountPercent != null ? <>{o.discountPercent.toFixed(2)}%<span className="block text-xs text-gray-500">keeps {Math.round((o.discountKeep ?? 1) * 100)}%</span></> : '—'}</td>
        <td className="px-3 py-3 text-right">{pts2(o.basePoints)}</td>
        <td className="px-3 py-3 text-right">{o.bonusPoints ? `+${pts2(o.bonusPoints)}` : '—'}</td>
        <td className={`px-3 py-3 text-right font-semibold ${o.points < 0 ? 'text-red-600' : 'text-gray-900'}`}>{pts2(o.points)}</td>
        <td className="px-3 py-3"><StatusPill status={o.status} /></td>
        {showRating && (
          <td className="px-3 py-3">{o.rating ? <><Stars n={o.rating.stars} />{!o.rating.counted && <span className="block text-xs text-gray-500">not counted — same network</span>}</> : <span className="text-gray-400">—</span>}</td>
        )}
      </tr>
      {open && <tr><td colSpan={cols} className="bg-gray-50 px-3 py-3"><OrderLines o={o} month={month} /></td></tr>}
    </Fragment>
  );
}

/** The ledger lines behind one order (earn, reversals, recalculations). */
function OrderLines({ o, month }: { o: MyOrder; month: string }) {
  const multiplied = o.portions.some((p) => p.multiplier !== 1);
  return (
    <div>
      {multiplied && (
        <p className="mb-2 text-xs text-gray-600">
          Invoice multipliers: {o.portions.map((p) => `${rupees(p.from)}–${rupees(p.to)} ×${p.multiplier}`).join(', ')}
        </p>
      )}
      <ul className="space-y-1 text-xs">
        {o.lines.map((l) => (
          <li key={l._id} className="flex justify-between gap-3">
            <span className="text-gray-700">{fmtDate(l.eventAt)} · {describeMyLine(l, month)}{l.landedLate ? ' · paid after month close' : ''}</span>
            <span className={`shrink-0 font-medium ${l.points < 0 ? 'text-red-600' : 'text-gray-900'}`}>{l.points > 0 ? '+' : ''}{pts2(l.points)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PendingCard({ p }: { p: MyPendingOrder }) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div><span className="font-mono text-gray-900">{p.orderNumber}</span> <span className="text-xs text-gray-500">{fmtDate(p.date)}</span></div>
        <StatusPill status="pending" />
      </div>
      <p className="mt-1 text-gray-700">{p.customerName}</p>
      <p className="mt-1 text-xs text-gray-500">Points appear once the payment is verified</p>
    </li>
  );
}

function OrderCard({ o, month, showRating, open, onToggle }: { o: MyOrder; month: string; showRating: boolean; open: boolean; onToggle: () => void }) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white text-sm">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full p-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span className="font-mono text-gray-900">{o.orderNumber}</span>
            <span className="text-xs text-gray-500">{fmtDate(o.date)}</span>
          </div>
          <StatusPill status={o.status} />
        </div>
        <p className="mt-1 text-gray-800">{o.customerName || '—'}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {[
            o.valueExGst != null ? `${rupees(o.valueExGst)} ex-GST` : null,
            o.discountPercent != null ? `${o.discountPercent.toFixed(2)}% off (keeps ${Math.round((o.discountKeep ?? 1) * 100)}%)` : null,
            o.isB2B ? 'B2B' : null,
            o.specialSourcing ? `special sourcing (keeps ${Math.round((o.sourcingKeep ?? 0.75) * 100)}%)` : null,
          ].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="text-xs text-gray-600">{pts2(o.basePoints)} pts{o.bonusPoints ? ` + ${pts2(o.bonusPoints)} bonus` : ''}</span>
          <span className={`text-base font-semibold ${o.points < 0 ? 'text-red-600' : 'text-gray-900'}`}>{pts2(o.points)} pts</span>
        </div>
        {showRating && o.rating && (
          <div className="mt-1 flex items-center gap-2"><Stars n={o.rating.stars} />{!o.rating.counted && <span className="text-xs text-gray-500">not counted — same network</span>}</div>
        )}
      </button>
      {open && <div className="border-t border-gray-100 bg-gray-50 px-3 py-2"><OrderLines o={o} month={month} /></div>}
    </li>
  );
}
