'use client';

import { dayText, money, rupees, type DealSummary } from './api';

const part = (d: DealSummary) => `${d.partLabel}${d.installment ? ` (payment ${d.installment} of ${d.installments})` : ''}`;

/**
 * One line for a list row: "Advance (payment 1 of 2) · agreed ₹29,000 · balance after ₹19,000".
 * Every number is the server's.
 */
export function DealLine({ d }: { d: DealSummary }) {
  return (
    <span className="block text-xs text-indigo-800">
      {part(d)} · agreed {money(d.agreedTotal, d.currency)} · balance after {money(d.balanceAfter, d.currency)}
    </span>
  );
}

/** The full picture, for the payment panel (accounts / admin / procurement alike). */
export default function DealSummaryBox({ d }: { d: DealSummary }) {
  const foreign = d.currency !== 'INR';
  const rows: [string, string][] = [
    ['Agreed total', `${money(d.agreedTotal, d.currency)} with ${d.supplierName}`],
    ['This payment', `${part(d)} · ${money(d.thisAmount, d.currency)}${foreign && d.thisRupees != null ? ` (${rupees(d.thisRupees)} debited)` : ''}`],
    ['Paid before this', `${money(d.paidBefore, d.currency)}${d.waitingBefore > 0 ? ` (+ ${money(d.waitingBefore, d.currency)} not yet paid)` : ''}`],
    ['Balance after this', money(d.balanceAfter, d.currency)],
    ['Deal today', `paid ${money(d.paidSoFar, d.currency)}${foreign && d.rupeesPaid > 0 ? ` (${rupees(d.rupeesPaid)} debited)` : ''} · balance due ${money(d.balanceDue, d.currency)}`],
    ['Dates', `advance paid ${d.startDate ? dayText(d.startDate) : 'not yet'} · completion ${dayText(d.completionDate)}`],
  ];
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 text-sm" aria-label="Made to order — supplier deal">
      <p className="mb-1 font-semibold text-gray-900">Made to order · paid in parts</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd className={k === 'Balance after this' ? 'font-semibold text-gray-900' : 'text-gray-800'}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
