'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Banknote, ChevronLeft, ChevronRight, CircleDot, Clock, RefreshCw, Users } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { overviewKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST, formatIsoDateIST } from '@/lib/datetime';
import { duration } from '@/lib/teamActivity';
import { foreignTotals } from '@/components/payments/api';

/**
 * Company overview — what every team is doing, on one page: today's numbers,
 * money waiting on the admin or accounts, each team's people and workload, and
 * a feed of what staff did. Read-only; every figure links to where it is worked.
 *
 * `?date=YYYY-MM-DD` looks back at one India calendar day (no date = today, live).
 * A past day's own events (orders paid, consultations received, staff actions, the
 * month's payments up to that day) are for that day; queues and waiting work have
 * no history to rebuild from, so they show today's figure tagged "Now".
 */

type Overview = {
  generatedAt: string;
  /** The IST day shown. `isToday: false` → queue/waiting figures are as of now, not this day. */
  day: { date: string; isToday: boolean; monthFrom: string; weekFrom: string };
  today: {
    paidOrders: number; paidValue: number; gtmOrders: number; websiteOrders: number;
    newConsultations: number; consultationsReceived: number; openSupportTickets: number; salesLinksWaiting: number;
  };
  money: {
    /** `pending`: foreign bills in `n` but not in `amount` — their rupees are known when paid. */
    awaitingApproval: { n: number; amount: number; pending?: number };
    toPay: { n: number; amount: number; pending?: number; onHold: number };
    paidThisMonth: {
      n: number; amount: number; byTeam: { team: string; label: string; n: number; amount: number }[];
      /** Paid from foreign-currency accounts: not rupees, so never in `amount`. */
      foreign?: { currency: string; amount: number }[];
    };
    itemRefundsToPay: number;
  };
  /** `online` is null on a past day: presence is live only. */
  teams: { team: string; label: string; members: number; online: number | null; waiting: number; overdue: number; actionsThisWeek: number; actionsOnDay: number }[];
  people: { id: string; name: string; teamLabel: string; role: string | null; online: boolean | null; actionsThisWeek: number; actionsOnDay: number; lastAction: string | null }[];
  overdue: { orderId: string; orderNumber: string; customer: string; stageLabel: string; waitingFor: string; waitingHours: number }[];
  feed: { at: string; who: string; team: string; text: string; area: string; link: string | null }[];
};

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const ago = (iso: string | null, now: number) => (iso ? `${duration(Math.max(0, now - new Date(iso).getTime()))} ago` : 'no activity this week');

/** The first day the server accepts (services/adminOverviewService.js FIRST_DAY). */
const FIRST_DAY = '2024-01-01';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Calendar arithmetic on a YYYY-MM-DD — done in UTC so no local zone can shift the day. */
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** "5 Nov" / "Thu, 5 Nov 2026" for a YYYY-MM-DD India day (noon IST: never near a day edge). */
const dayLabel = (ymd: string, long = false) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', ...(long ? { weekday: 'short', year: 'numeric' } : {}),
}).format(new Date(`${ymd}T12:00:00+05:30`));

/** Marks a live figure on a past day's view, so nobody reads it as that day's. */
const NOW_TAG = 'Now — not for this date';
function NowTag() {
  return <span className="ml-1.5 inline-block rounded-full bg-gray-100 px-2 py-0.5 align-middle text-[10px] font-medium normal-case tracking-normal text-gray-600">{NOW_TAG}</span>;
}

function Tile({ label, value, sub, href, tone = 'default', live = false }: { label: string; value: string | number; sub?: string; href?: string; tone?: 'default' | 'warn'; live?: boolean }) {
  const body = (
    <div className={`h-full rounded-xl border p-4 ${tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'} ${href ? 'hover:border-blue-400' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}{live && <NowTag />}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/** " + 1 foreign bill" — counted in the tile but not in its rupee total. */
const foreignNote = (n?: number) => (n ? ` + ${n} foreign bill${n === 1 ? '' : 's'}` : '');

export default function CompanyOverviewPage() {
  // The chosen day lives in the address (useSearchParams), so it needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="p-6 text-sm text-gray-500">Loading…</p>}>
      <CompanyOverview />
    </Suspense>
  );
}

/** Prev / date / Next / Today. Future days can't be picked; the server refuses them too. */
function DayPicker({ date, today, onChange }: { date: string; today: string; onChange: (ymd: string) => void }) {
  const isToday = date === today;
  const btn = 'inline-flex h-9 items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose a day">
      <button type="button" className={btn} onClick={() => onChange(addDays(date, -1))} disabled={date <= FIRST_DAY} aria-label="Previous day">
        <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">Prev</span>
      </button>
      <input
        type="date" aria-label="Day" value={date} min={FIRST_DAY} max={today}
        onChange={(e) => { const v = e.target.value; if (YMD.test(v) && v <= today && v >= FIRST_DAY) onChange(v); }}
        className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-800"
      />
      <button type="button" className={btn} onClick={() => onChange(addDays(date, 1))} disabled={isToday} aria-label="Next day">
        <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" />
      </button>
      <button type="button" className={btn} onClick={() => onChange(today)} disabled={isToday}>Today</button>
    </div>
  );
}

function CompanyOverview() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Today in India, from this device's clock. The server re-checks with its own.
  const today = formatIsoDateIST(Date.now());
  const asked = params.get('date');
  // No date, or today's, is the live view; anything else goes to the server as
  // asked — a typed future/bad date comes back as an error, not as today's numbers.
  const date = asked && asked !== today ? asked : today;
  const live = date === today;
  const pick = (ymd: string) => router.replace(ymd === today ? pathname : `${pathname}?date=${ymd}`, { scroll: false });

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: [...overviewKeys.all, live ? 'today' : date],
    queryFn: () => apiClient.get<Overview>(live ? '/admin/overview' : `/admin/overview?date=${encodeURIComponent(date)}`),
    // Today keeps itself fresh; a past day changes only in its "Now" figures — refresh for those.
    refetchInterval: live ? 60_000 : false,
    // A 4xx (a bad or future date in the address) won't fix itself on retry.
    retry: (n, err) => { const st = (err as { status?: number })?.status ?? 0; return n < 2 && !(st >= 400 && st < 500); },
  });
  const now = data ? new Date(data.generatedAt).getTime() : Date.now();
  // What the server says it showed (it decides "today", not this device's clock).
  const past = data ? !data.day.isToday : !live;
  const shown = data?.day.date ?? date;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Company overview</h1>
          <p className="text-sm text-gray-600">Every team, what is waiting on whom, and what everyone has been doing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DayPicker date={YMD.test(date) ? date : today} today={today} onChange={pick} />
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> {data ? `Updated ${formatDateTimeIST(data.generatedAt)}` : 'Refresh'}
          </button>
        </div>
      </div>

      {past && data && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Looking back at <strong>{dayLabel(shown, true)}</strong>. Orders, consultations, payments and staff actions are for that day.
          Cards tagged <em>{NOW_TAG}</em> show today&apos;s queue — there is no record of how they looked on that day.
        </p>
      )}

      {isPending && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && (
        <p role="alert" className="text-sm text-red-700">
          Couldn&apos;t load the overview{live ? '' : ` for ${asked}: ${(error?.message || 'unknown error').replace(/\.$/, '')}`}. {live ? 'Try refresh.' : <button type="button" className="font-medium underline" onClick={() => pick(today)}>Go to today</button>}
        </p>
      )}
      {data && (
        <>
          <section aria-labelledby="ov-today">
            <h2 id="ov-today" className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{past ? dayLabel(shown, true) : 'Today'}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Orders paid" value={data.today.paidOrders} sub={`${rupees(data.today.paidValue)} · ${data.today.gtmOrders} GTM, ${data.today.websiteOrders} website`} href="/admin/orders" />
              <Tile label="Payment links waiting" value={data.today.salesLinksWaiting} sub="GTM orders the customer has not paid yet" live={past} />
              {past
                ? <Tile label="Consultations received" value={data.today.consultationsReceived} sub="Booked on this day" href="/admin/consultation" />
                : <Tile label="New consultations" value={data.today.newConsultations} href="/admin/consultation" tone={data.today.newConsultations ? 'warn' : 'default'} />}
              <Tile label="Open support tickets" value={data.today.openSupportTickets} href="/admin/support" live={past} />
            </div>
          </section>

          <section aria-labelledby="ov-money">
            <h2 id="ov-money" className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Money waiting</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* Not the admin's queue any more: accounts decides these. Shown
                  without the warning tone, because nothing here is theirs to do. */}
              <Tile label="Waiting for accounts to approve" value={data.money.awaitingApproval.n} sub={`${rupees(data.money.awaitingApproval.amount)}${foreignNote(data.money.awaitingApproval.pending)}`} href="/admin/payments" live={past} />
              <Tile label="Approved — for you to pay" value={data.money.toPay.n} sub={`${rupees(data.money.toPay.amount)}${foreignNote(data.money.toPay.pending)}${data.money.toPay.onHold ? ` · ${data.money.toPay.onHold} on hold` : ''}`} href="/admin/payments" live={past} />
              <Tile label="Item refunds to pay" value={data.money.itemRefundsToPay} sub="Approved by accounts, waiting for you" href="/admin/refunds" tone={data.money.itemRefundsToPay ? 'warn' : 'default'} live={past} />
              {/* A past day: the 1st of its month up to the end of that day ("Paid 1–5 Nov"). */}
              <Tile label={past ? `Paid ${dayLabel(data.day.monthFrom).split(' ')[0]}–${dayLabel(shown)}` : 'Paid this month'} value={rupees(data.money.paidThisMonth.amount)}
                sub={[
                  data.money.paidThisMonth.byTeam.map((t) => `${t.label} ${rupees(t.amount)}`).join(' · ') || 'Nothing yet',
                  data.money.paidThisMonth.foreign?.length ? `+ ${foreignTotals(data.money.paidThisMonth.foreign)} from foreign accounts (not in ₹)` : '',
                ].filter(Boolean).join(' · ')} href="/admin/payments" />
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
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
                    <Users className="h-3.5 w-3.5" /> {t.members} people
                    {t.online != null && <> · <CircleDot className={`h-3 w-3 ${t.online ? 'text-green-600' : 'text-gray-300'}`} /> {t.online} online</>}
                  </p>
                  <p className="mt-2 text-sm text-gray-800">{t.waiting} waiting{t.overdue ? <span className="font-semibold text-red-700"> · {t.overdue} overdue</span> : ''}{past && <NowTag />}</p>
                  <p className="text-xs text-gray-500">
                    {past
                      ? `${t.actionsOnDay} actions that day · ${t.actionsThisWeek} in the 7 days to ${dayLabel(shown)}`
                      : `${t.actionsOnDay ?? 0} today · ${t.actionsThisWeek} actions this week`}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {!past && data.overdue.length > 0 && (
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
                    {p.online != null && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.online ? 'bg-green-500' : 'bg-gray-300'}`} aria-label={p.online ? 'online' : 'offline'} />}
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-gray-900">{p.name}</span>
                      <span className="block text-xs text-gray-500">{p.role || p.teamLabel} · {p.teamLabel}</span>
                    </span>
                    <span className="text-right text-xs text-gray-500">
                      {past
                        ? <>{p.actionsOnDay} that day · {p.actionsThisWeek} in 7 days<br />{p.lastAction ? `last ${formatDateTimeIST(p.lastAction)}` : 'no activity those 7 days'}</>
                        : <>{p.actionsThisWeek} this week<br />{ago(p.lastAction, now)}</>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="ov-feed" className="rounded-xl border border-gray-200 bg-white">
              <h2 id="ov-feed" className="border-b px-4 py-3 text-sm font-semibold text-gray-800">{past ? `What everyone did on ${dayLabel(shown)}` : 'What everyone has been doing'}</h2>
              {data.feed.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">{past ? 'No staff activity that day.' : 'No staff activity yet.'}</p>
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
