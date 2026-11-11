'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { lateBy, type MetaLeadActivity } from './metaLeadTypes';

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
] as const;

const COLUMNS: { key: string; label: string; title: string }[] = [
  { key: 'holding', label: 'Holding', title: 'Leads this person is following up on now' },
  { key: 'overdue', label: 'Overdue now', title: 'Next follow-up time has passed' },
  { key: 'dueToday', label: 'Due today', title: 'Next follow-up due before tonight' },
  { key: 'taken', label: 'Taken', title: 'Leads taken in this period' },
  { key: 'followUps', label: 'Follow-ups', title: 'Follow-ups recorded in this period' },
  { key: 'onTimeRate', label: 'On time', title: 'Follow-ups saved before their deadline' },
  { key: 'rescheduled', label: 'Moved', title: 'Times a deadline was moved' },
  { key: 'avgMinutesToFirst', label: 'First follow-up', title: 'Average time from taking a lead to its first follow-up' },
  { key: 'openExplanations', label: 'Questions open', title: 'Explanations asked and not yet answered' },
];

const cell = (key: string, v: number | null) => {
  if (v == null) return '—';
  if (key === 'onTimeRate') return `${v}%`;
  if (key === 'avgMinutesToFirst') return lateBy(v);
  return String(v);
};

/** For the admin, Marketing head and GTM head: who did what, what is late, and every reason given. */
export default function MetaLeadActivityView() {
  const [days, setDays] = useState<number>(7);
  const q = useQuery({
    queryKey: staffKeys.metaLeadActivity(days),
    queryFn: () => apiClient.get<MetaLeadActivity>(`/staff/meta-leads/activity?days=${days}`),
    refetchInterval: 60_000,
  });
  const data = q.data;

  return (
    <section aria-label="Team activity" className="space-y-5">
      <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button key={r.days} type="button" role="radio" aria-checked={days === r.days} onClick={() => setDays(r.days)}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${days === r.days ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {r.label}
          </button>
        ))}
      </div>

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load team activity.')}</p>}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2">Person</th>
                  {COLUMNS.map((c) => <th key={c.key} scope="col" title={c.title} className="whitespace-nowrap px-3 py-2 text-right">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.people.length === 0 && <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-4 text-center text-gray-500">No activity in this period.</td></tr>}
                {data.people.map((p) => (
                  <tr key={p.userId ?? p.name}>
                    <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium text-gray-900">{p.name}</th>
                    {COLUMNS.map((c) => {
                      const v = p[c.key as keyof typeof p] as number | null;
                      const bad = (c.key === 'overdue' || c.key === 'openExplanations') && (v ?? 0) > 0;
                      return <td key={c.key} className={`px-3 py-2 text-right tabular-nums ${bad ? 'font-semibold text-red-700' : 'text-gray-700'}`}>{cell(c.key, v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-base font-semibold text-gray-900">Overdue right now ({data.overdue.length})</h2>
            {data.overdue.length === 0 ? <p className="mt-1 text-sm text-gray-500">Nothing is late. 🎉</p> : (
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                {data.overdue.map((o) => (
                  <li key={o.id} className="px-3 py-2 text-sm">
                    <span className="font-medium text-gray-900">{o.name || 'No name'}</span>
                    <span className="text-gray-600"> · {o.product || o.tab} · {o.followingUp}</span>
                    <span className="font-medium text-red-700"> · late by {lateBy(o.overdueMinutes)}</span>
                    {o.explanationOpen && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">question open</span>}
                    {o.lateReason && <p className="text-gray-600">Reason: {o.lateReason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="text-base font-semibold text-gray-900">Reasons and explanations</h2>
            {data.reasons.length === 0 ? <p className="mt-1 text-sm text-gray-500">None in this period.</p> : (
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                {data.reasons.map((r, i) => (
                  <li key={`${r.leadId}-${i}`} className="px-3 py-2 text-sm">
                    <span className="font-medium text-gray-900">{r.label}</span>
                    <span className="text-gray-600"> · {r.who} · {r.product || r.tab} · {formatDateTimeIST(r.at)}</span>
                    <p className="text-gray-700">{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
