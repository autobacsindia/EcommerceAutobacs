'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Banknote, CircleDot, Clock, RefreshCw, Users } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { overviewKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { duration } from '@/lib/teamActivity';

/**
 * Company overview — what every team is doing, on one page: today's numbers,
 * money waiting on the admin or accounts, each team's people and workload, and
 * a feed of what staff did. Read-only; every figure links to where it is worked.
 */

type Overview = {
  generatedAt: string;
  today: {
    paidOrders: number; paidValue: number; gtmOrders: number; websiteOrders: number;
    newConsultations: number; openSupportTickets: number; salesLinksWaiting: number;
  };
  money: {
    awaitingApproval: { n: number; amount: number };
    toPay: { n: number; amount: number; onHold: number };
    paidThisMonth: { n: number; amount: number; byTeam: { team: string; label: string; n: number; amount: number }[] };
    itemRefundsToPay: number;
  };
  teams: { team: string; label: string; members: number; online: number; waiting: number; overdue: number; actionsThisWeek: number }[];
  people: { id: string; name: string; teamLabel: string; role: string | null; online: boolean; actionsThisWeek: number; lastAction: string | null }[];
  overdue: { orderId: string; orderNumber: string; customer: string; stageLabel: string; waitingFor: string; waitingHours: number }[];
  feed: { at: string; who: string; team: string; text: string; area: string; link: string | null }[];
};

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const ago = (iso: string | null, now: number) => (iso ? `${duration(Math.max(0, now - new Date(iso).getTime()))} ago` : 'no activity this week');

function Tile({ label, value, sub, href, tone = 'default' }: { label: string; value: string | number; sub?: string; href?: string; tone?: 'default' | 'warn' }) {
  const body = (
    <div className={`h-full rounded-xl border p-4 ${tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'} ${href ? 'hover:border-blue-400' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default function CompanyOverviewPage() {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: overviewKeys.all,
    queryFn: () => apiClient.get<Overview>('/admin/overview'),
    refetchInterval: 60_000,
  });
  const now = data ? new Date(data.generatedAt).getTime() : Date.now();

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Company overview</h1>
          <p className="text-sm text-gray-600">Every team, what is waiting on whom, and what everyone has been doing.</p>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> {data ? `Updated ${formatDateTimeIST(data.generatedAt)}` : 'Refresh'}
        </button>
      </div>

      {isPending && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && <p role="alert" className="text-sm text-red-700">Couldn&apos;t load the overview. Try refresh.</p>}
      {data && (
        <>
          <section aria-labelledby="ov-today">
            <h2 id="ov-today" className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Today</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Orders paid" value={data.today.paidOrders} sub={`${rupees(data.today.paidValue)} · ${data.today.gtmOrders} GTM, ${data.today.websiteOrders} website`} href="/admin/orders" />
              <Tile label="Payment links waiting" value={data.today.salesLinksWaiting} sub="GTM orders the customer has not paid yet" />
              <Tile label="New consultations" value={data.today.newConsultations} href="/admin/consultation" tone={data.today.newConsultations ? 'warn' : 'default'} />
              <Tile label="Open support tickets" value={data.today.openSupportTickets} href="/admin/support" />
            </div>
          </section>

          <section aria-labelledby="ov-money">
            <h2 id="ov-money" className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Money waiting</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* Not the admin's queue any more: accounts decides these. Shown
                  without the warning tone, because nothing here is theirs to do. */}
              <Tile label="Waiting for accounts to approve" value={data.money.awaitingApproval.n} sub={rupees(data.money.awaitingApproval.amount)} href="/admin/payments" />
              <Tile label="Approved — for you to pay" value={data.money.toPay.n} sub={`${rupees(data.money.toPay.amount)}${data.money.toPay.onHold ? ` · ${data.money.toPay.onHold} on hold` : ''}`} href="/admin/payments" />
              <Tile label="Item refunds to pay" value={data.money.itemRefundsToPay} sub="Approved by accounts, waiting for you" href="/admin/refunds" tone={data.money.itemRefundsToPay ? 'warn' : 'default'} />
              <Tile label="Paid this month" value={rupees(data.money.paidThisMonth.amount)} sub={data.money.paidThisMonth.byTeam.map((t) => `${t.label} ${rupees(t.amount)}`).join(' · ') || 'Nothing yet'} href="/admin/payments" />
            </div>
          </section>

          <section aria-labelledby="ov-teams">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="ov-teams" className="text-sm font-semibold uppercase tracking-wide text-gray-500">Teams</h2>
              <Link href="/admin/team-activity" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">Team activity <ArrowRight className="h-4 w-4" /></Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {data.teams.map((t) => (
                <div key={t.team} className={`rounded-xl border p-4 ${t.overdue ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
                  <p className="font-semibold text-gray-900">{t.label}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600"><Users className="h-3.5 w-3.5" /> {t.members} people · <CircleDot className={`h-3 w-3 ${t.online ? 'text-green-600' : 'text-gray-300'}`} /> {t.online} online</p>
                  <p className="mt-2 text-sm text-gray-800">{t.waiting} waiting{t.overdue ? <span className="font-semibold text-red-700"> · {t.overdue} overdue</span> : ''}</p>
                  <p className="text-xs text-gray-500">{t.actionsThisWeek} actions this week</p>
                </div>
              ))}
            </div>
          </section>

          {data.overdue.length > 0 && (
            <section aria-labelledby="ov-overdue" className="rounded-xl border border-red-200 bg-white">
              <h2 id="ov-overdue" className="flex items-center gap-2 border-b border-red-100 px-4 py-3 text-sm font-semibold text-red-800"><AlertTriangle className="h-4 w-4" /> Overdue now</h2>
              <ul className="divide-y">
                {data.overdue.map((r) => (
                  <li key={`${r.orderId}-${r.stageLabel}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                    <Link href={`/admin/orders/${r.orderId}`} className="font-medium text-blue-700 hover:underline">{r.orderNumber}</Link>
                    <span className="text-gray-600">{r.customer} · {r.stageLabel}</span>
                    <span className="ml-auto text-gray-700">on <strong>{r.waitingFor}</strong> for {duration(r.waitingHours * 3600000)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <section aria-labelledby="ov-people" className="rounded-xl border border-gray-200 bg-white">
              <h2 id="ov-people" className="border-b px-4 py-3 text-sm font-semibold text-gray-800">People</h2>
              <ul className="divide-y">
                {data.people.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.online ? 'bg-green-500' : 'bg-gray-300'}`} aria-label={p.online ? 'online' : 'offline'} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-gray-900">{p.name}</span>
                      <span className="block text-xs text-gray-500">{p.role || p.teamLabel} · {p.teamLabel}</span>
                    </span>
                    <span className="text-right text-xs text-gray-500">{p.actionsThisWeek} this week<br />{ago(p.lastAction, now)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="ov-feed" className="rounded-xl border border-gray-200 bg-white">
              <h2 id="ov-feed" className="border-b px-4 py-3 text-sm font-semibold text-gray-800">What everyone has been doing</h2>
              {data.feed.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">No staff activity yet.</p>
              ) : (
                <ol className="divide-y">
                  {data.feed.map((f, i) => (
                    <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-gray-900">{f.who}</span> <span className="text-gray-500">({f.team})</span>{' '}
                        {f.link ? <Link href={f.link} className="text-gray-800 hover:underline">{f.text}</Link> : <span className="text-gray-800">{f.text}</span>}
                        <span className="block text-xs text-gray-500">{formatDateTimeIST(f.at)}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{f.area}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-gray-500"><Banknote className="h-3.5 w-3.5" /> Shop figures (revenue, stock, customers) stay on the Dashboard.</p>
        </>
      )}
    </div>
  );
}
