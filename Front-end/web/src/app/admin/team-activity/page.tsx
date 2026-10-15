'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, RefreshCw, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { teamActivityKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { duration } from '@/lib/teamActivity';

/**
 * Team activity — who is holding what, and how long each step took.
 *
 * Read-only: everything comes from the order workflow's own history (who acted,
 * when). A step's wait is charged to the team that owned the stage, so "who
 * delayed" means the team (or seller) the order was waiting on, not whoever
 * finally moved it.
 */

type WaitingRow = {
  orderId: string; orderNumber: string; customer: string; totalAmount: number;
  source: 'sales' | 'website'; seller: string | null;
  stage: string; stageLabel: string; team: string; waitingFor: string;
  since: string; waitingHours: number; limitHours: number | null; overdue: boolean;
};
type Waiting = { rows: WaitingRow[]; teams: { team: string; waiting: number; overdue: number }[]; truncated: boolean };
type Step = {
  at: string; action: string; label: string; by: string | null; byTeam: string | null; item: string | null; note: string | null;
  waited: { ms: number; stage: string; stageLabel: string; team: string | null; late: boolean; limitHours: number | null } | null;
};
type Timeline = {
  orderId: string; orderNumber: string; customer: string; seller: string | null; status: string; totalAmount: number;
  steps: Step[]; waitingNow: { stage: string; stageLabel: string; team: string; waitingFor: string; since: string }[];
};
type Perf = {
  days: number; orders: number; truncated: boolean;
  teams: { team: string; steps: number; late: number; lateShare: number; medianHours: number | null }[];
  people: { id: string; name: string; team: string; steps: number; late: number; lateShare: number; medianHours: number | null }[];
};

const TEAM: Record<string, string> = {
  sales: 'GTM', procurement: 'Procurement', accounts: 'Accounts', operations: 'Operations', marketing: 'Marketing', admin: 'Admin',
};
const teamName = (t: string | null) => (t ? TEAM[t] || t : '—');

const hours = (h: number) => duration(h * 3600000);
const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function TimelinePanel({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: teamActivityKeys.order(orderId),
    queryFn: () => apiClient.get<Timeline>(`/admin/team-activity/orders/${orderId}`),
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="Order timeline"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{data ? `Order ${data.orderNumber}` : 'Order'}</h2>
            {data && (
              <p className="text-sm text-gray-500">
                {data.customer} · {rupees(data.totalAmount)} · {data.seller ? `sold by ${data.seller}` : 'website order'}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Couldn&apos;t load this order&apos;s timeline.</p>}
        {data && (
          <>
            {data.waitingNow.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {data.waitingNow.map((w) => (
                  <p key={w.stage}>Waiting now: <strong>{w.stageLabel}</strong> — on {w.waitingFor} since {formatDateTimeIST(w.since)}</p>
                ))}
              </div>
            )}
            <ol className="relative space-y-4 border-l border-gray-200 pl-5">
              {data.steps.map((s, i) => (
                <li key={i} className="relative">
                  <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${s.waited?.late ? 'bg-red-500' : 'bg-emerald-500'}`} />
                  <p className="text-sm font-medium text-gray-900">
                    {s.label}{s.item ? <span className="font-normal text-gray-600"> — {s.item}</span> : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDateTimeIST(s.at)}{s.by ? ` · by ${s.by}${s.byTeam ? ` (${teamName(s.byTeam)})` : ''}` : ''}
                  </p>
                  {s.waited && (
                    <p className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.waited.late ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                      <Clock className="h-3 w-3" />
                      Waited {duration(s.waited.ms)} at “{s.waited.stageLabel}” on {teamName(s.waited.team)}
                      {s.waited.late && s.waited.limitHours != null ? ` — late (limit ${hours(s.waited.limitHours)})` : ''}
                    </p>
                  )}
                  {s.note && <p className="mt-1 text-xs italic text-gray-600">“{s.note}”</p>}
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </div>
  );
}

function WaitingTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: teamActivityKeys.waiting(),
    queryFn: () => apiClient.get<Waiting>('/admin/team-activity/waiting'),
  });
  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-red-600">Couldn&apos;t load what is waiting.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {data.teams.map((t) => (
          <div key={t.team} className={`rounded-lg border px-4 py-2 text-sm ${t.overdue ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <p className="font-semibold text-gray-900">{teamName(t.team)}</p>
            <p className="text-gray-600">{t.waiting} waiting{t.overdue ? <span className="font-semibold text-red-700"> · {t.overdue} overdue</span> : ''}</p>
          </div>
        ))}
        <button type="button" onClick={() => refetch()} disabled={isFetching}
          className="ml-auto flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {data.rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Nothing is waiting on any team right now.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Waiting at</th>
                <th className="px-4 py-3">Waiting on</th>
                <th className="px-4 py-3">For</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map((r) => (
                <tr key={`${r.orderId}-${r.stage}`} className={r.overdue ? 'bg-red-50/60' : ''}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.orderNumber}</p>
                    <p className="text-xs text-gray-500">{r.customer} · {rupees(r.totalAmount)}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.stageLabel}</td>
                  <td className="px-4 py-3 text-gray-700">{r.waitingFor}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`inline-flex items-center gap-1 font-medium ${r.overdue ? 'text-red-700' : 'text-gray-700'}`}>
                      {r.overdue && <AlertTriangle className="h-3.5 w-3.5" />}{hours(r.waitingHours)}
                    </span>
                    {r.limitHours != null && <p className="text-xs text-gray-400">limit {hours(r.limitHours)}</p>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => onOpen(r.orderId)} className="text-sm font-medium text-blue-600 hover:underline">
                      Timeline
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PerformanceTab() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError } = useQuery({
    queryKey: teamActivityKeys.performance(days),
    queryFn: () => apiClient.get<Perf>(`/admin/team-activity/performance?days=${days}`),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">Period:</span>
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
            className={`rounded-lg border px-3 py-1.5 ${days === d ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            Last {d} days
          </button>
        ))}
      </div>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Couldn&apos;t load the numbers.</p>}
      {data && (
        <>
          <p className="text-sm text-gray-500">{data.orders} orders in the workflow during this period. “Typical” is the median wait; “late” means past that stage&apos;s limit.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">By team</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Team</th><th className="px-4 py-2">Steps</th><th className="px-4 py-2">Typical wait</th><th className="px-4 py-2">Late</th></tr></thead>
                <tbody className="divide-y">
                  {data.teams.map((t) => (
                    <tr key={t.team}>
                      <td className="px-4 py-2 font-medium text-gray-900">{teamName(t.team)}</td>
                      <td className="px-4 py-2">{t.steps}</td>
                      <td className="px-4 py-2">{t.medianHours != null ? hours(t.medianHours) : '—'}</td>
                      <td className={`px-4 py-2 ${t.late ? 'font-semibold text-red-700' : ''}`}>{t.late} ({t.lateShare}%)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">By person</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Person</th><th className="px-4 py-2">Steps</th><th className="px-4 py-2">Typical wait</th><th className="px-4 py-2">Late</th></tr></thead>
                <tbody className="divide-y">
                  {data.people.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2"><span className="font-medium text-gray-900">{p.name}</span> <span className="text-xs text-gray-500">{teamName(p.team)}</span></td>
                      <td className="px-4 py-2">{p.steps}</td>
                      <td className="px-4 py-2">{p.medianHours != null ? hours(p.medianHours) : '—'}</td>
                      <td className={`px-4 py-2 ${p.late ? 'font-semibold text-red-700' : ''}`}>{p.late} ({p.lateShare}%)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default function TeamActivityPage() {
  const [tab, setTab] = useState<'waiting' | 'performance'>('waiting');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team activity</h1>
        <p className="text-sm text-gray-600">What each team is holding now, and how long every step of an order took — and on whom.</p>
      </div>
      <div className="flex gap-2" role="tablist">
        {([['waiting', 'Waiting now'], ['performance', 'Performance']] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === key ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'waiting' ? <WaitingTab onOpen={setOpen} /> : <PerformanceTab />}
      {open && <TimelinePanel orderId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
