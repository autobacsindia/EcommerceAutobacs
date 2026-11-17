'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage, paymentMoney, rupees, STATUS_TONE, type PaymentStatus } from './api';

/**
 * Admin: type a project ID (PRJ-0007), an order number (#AB12CD34) or another ID
 * (INV-2231) and see everything linked to it — the project or order, its tasks,
 * its payments and the orders / projects on the other side, each order with its
 * status timeline. Read-only; every list loads 20 more at a time.
 * Back-end: routes/adminLookup.js.
 */

type TaskRow = { id: string; code: string; title: string; status: string; bucket: string; dueOn: string | null; assignees: string[]; order: { id: string; number: string } | null };
type PaymentRow = {
  id: string; number: string; kind: 'supplier' | 'expense'; status: PaymentStatus; team: string; category: string;
  amount: number; currency: string; foreignAmount: number | null; payee: string; requestedBy: string;
  order: { id: string; number: string } | null; project: { id: string; code: string; name: string } | null;
  reference: string; paidAt: string | null; createdAt: string;
};
type OrderRow = {
  id: string; number: string; customer: string; city: string; total: number | null; status: string; paymentStatus: string;
  createdAt: string; timeline: { status: string; at: string | null }[];
};
type Page<T> = { items: T[]; nextCursor: string | null };
type Totals = { paid: { count: number; amount: number }; waiting: { count: number; amount: number }; closed: { count: number } };
type ProjectInfo = { id: string; code: string | null; name: string; statusLabel: string; owner: { name: string }; dueOn: string | null; archivedAt: string | null; progress: { total: number; done: number } };

export type LookupResult = {
  match: 'project' | 'order' | 'orders' | 'reference' | 'none';
  query: string;
  message?: string;
  project?: ProjectInfo;
  order?: OrderRow;
  orders?: OrderRow[];
  ordersCapped?: boolean;
  projects?: { id: string; code: string | null; name: string; archived: boolean }[];
  tasks?: { open?: Page<TaskRow>; done?: Page<TaskRow>; order?: Page<TaskRow> };
  payments?: Page<PaymentRow> & { totals?: Totals };
};

export const lookupKeys = {
  all: ['admin-lookup'] as const,
  one: (q: string) => [...lookupKeys.all, q] as const,
  more: (q: string, section: string) => [...lookupKeys.all, q, section] as const,
};

const call = (q: string, section?: string, cursor?: string) => {
  const p = new URLSearchParams({ q, ...(section ? { section } : {}), ...(cursor ? { cursor } : {}) });
  return apiClient.get<LookupResult>(`/admin/lookup?${p}`);
};

const STATUS_WORDS: Record<string, string> = {
  awaiting_payment: 'Awaiting payment', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered',
  returned: 'Returned', cancelled: 'Cancelled', todo: 'To do', in_progress: 'In progress', done: 'Done',
};
const words = (s: string) => STATUS_WORDS[s] || s.replace(/_/g, ' ');

export default function LinkLookup({ initial = '', onSearch }: { initial?: string; onSearch?: (q: string) => void }) {
  const [text, setText] = useState(initial);
  const [q, setQ] = useState(initial.trim());
  const res = useQuery({ queryKey: lookupKeys.one(q), queryFn: () => call(q), enabled: q.length > 0, staleTime: 30_000 });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = text.trim();
    setQ(next);
    onSearch?.(next);
  };

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="lookup-q" className="sr-only">Project ID, order number or other ID</label>
        <input id="lookup-q" value={text} onChange={(e) => setText(e.target.value)} autoFocus autoComplete="off" maxLength={80}
          placeholder="Type a project ID (PRJ-0007), an order number (#AB12CD34) or another ID"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
          <Search className="h-4 w-4" /> Find
        </button>
      </form>

      {!q ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          Every project has an ID like PRJ-0007 — it is on the project’s page. Payments can carry a project ID, an order and another ID.
        </p>
      ) : res.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Looking…</p>
      ) : res.isError ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{errorMessage(res.error, 'Could not search. Try again.')}</p>
      ) : res.data ? (
        <Result r={res.data} q={q} pick={(next) => { setText(next); setQ(next); onSearch?.(next); }} />
      ) : null}
    </div>
  );
}

function Result({ r, q, pick }: { r: LookupResult; q: string; pick: (q: string) => void }) {
  if (r.match === 'none') return <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">{r.message || 'Nothing found.'}</p>;
  if (r.match === 'orders') {
    return (
      <Section title={r.message || 'Several orders match'}>
        <ul className="divide-y">{(r.orders || []).map((o) => (
          <li key={o.id}><button type="button" onClick={() => pick(o.number)} className="w-full py-2 text-left text-sm hover:bg-gray-50">
            <strong>{o.number}</strong> · {o.customer} · {formatDateIST(o.createdAt)}
          </button></li>
        ))}</ul>
      </Section>
    );
  }
  return (
    <div className="space-y-4">
      {r.project && <ProjectCard p={r.project} />}
      {r.order && <Section title={`Order ${r.order.number}`}><OrderCard o={r.order} /></Section>}
      {r.match === 'order' && (
        <Section title="Projects">
          {r.projects?.length
            ? <ul className="flex flex-wrap gap-2">{r.projects.map((p) => (
              <li key={p.id}><button type="button" onClick={() => p.code && pick(p.code)} className="rounded-full border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50">
                <span className="font-mono text-xs text-gray-600">{p.code}</span> {p.name}{p.archived ? ' (deleted)' : ''}
              </button></li>
            ))}</ul>
            : <Empty>No tasks or payments of this order are in a project.</Empty>}
        </Section>
      )}
      {r.tasks?.open && <TaskList q={q} section="open" title="Open tasks" first={r.tasks.open} />}
      {r.tasks?.done && <TaskList q={q} section="done" title="Done tasks" first={r.tasks.done} />}
      {r.tasks?.order && <TaskList q={q} section="tasks" title="Tasks" first={r.tasks.order} />}
      {r.payments && <PaymentList q={q} first={r.payments} totals={r.payments.totals} />}
      {r.match === 'project' && (
        <Section title="Linked orders">
          {r.orders?.length ? <div className="space-y-3">{r.orders.map((o) => <OrderCard key={o.id} o={o} />)}</div> : <Empty>No task or payment of this project is linked to an order.</Empty>}
          {r.ordersCapped && <p className="mt-2 text-xs text-gray-500">Showing the first 50 orders.</p>}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-gray-500">{children}</p>;

function ProjectCard({ p }: { p: ProjectInfo }) {
  return (
    <section aria-label="Project" className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700">{p.code}</span>
        <h2 className="text-lg font-semibold text-gray-900">{p.name}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{p.archivedAt ? 'Deleted' : p.statusLabel}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Owner {p.owner.name} · {p.progress.done} of {p.progress.total} tasks done{p.dueOn ? ` · deadline ${formatDateIST(p.dueOn)}` : ''}
      </p>
      <Link href={`/admin/tasks?view=project&project=${encodeURIComponent(p.id)}`} className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">Open the project</Link>
    </section>
  );
}

function OrderCard({ o }: { o: OrderRow }) {
  return (
    <div className="rounded-lg border border-gray-100 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/orders/${encodeURIComponent(o.id)}`} className="font-semibold text-blue-700 hover:underline">{o.number}</Link>
        <span className="text-gray-700">{o.customer}{o.city ? `, ${o.city}` : ''}</span>
        {o.total != null && <span className="text-gray-700">· {rupees(o.total)}</span>}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{words(o.status)} · payment {o.paymentStatus}</span>
      </div>
      {o.timeline.length > 0 && (
        <ol aria-label={`Timeline of ${o.number}`} className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-gray-600">
          {o.timeline.map((t, i) => (
            <li key={`${t.status}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>→</span>}
              <span className="font-medium text-gray-800">{words(t.status)}</span>
              {t.at && <span>{formatDateIST(t.at)}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** First page from the lookup; "Show more" pages through `section` with its cursor. */
function useMore<T>(q: string, section: string, first: Page<T>, pick: (r: LookupResult) => Page<T> | undefined) {
  return useInfiniteQuery({
    queryKey: lookupKeys.more(q, section),
    queryFn: async ({ pageParam }) => (pageParam ? pick(await call(q, section, pageParam)) : first) || { items: [], nextCursor: null },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    initialData: { pages: [first], pageParams: [''] },
    staleTime: 30_000,
  });
}

function TaskList({ q, section, title, first }: { q: string; section: 'open' | 'done' | 'tasks'; title: string; first: Page<TaskRow> }) {
  const key = section === 'tasks' ? 'order' : section;
  const m = useMore(q, section, first, (r) => r.tasks?.[key]);
  const rows = m.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Section title={title}>
      {rows.length ? (
        <ul className="divide-y">{rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
            <Link href={`/admin/tasks?task=${encodeURIComponent(t.id)}`} className="font-mono text-xs text-blue-700 hover:underline">{t.code}</Link>
            <span className="min-w-0 flex-1 truncate text-gray-900">{t.title}</span>
            <span className="text-xs text-gray-600">{words(t.status)}{t.dueOn ? ` · due ${formatDateIST(t.dueOn)}` : ''}{t.assignees.length ? ` · ${t.assignees.join(', ')}` : ''}</span>
          </li>
        ))}</ul>
      ) : <Empty>None.</Empty>}
      <MoreButton m={m} />
    </Section>
  );
}

function PaymentList({ q, first, totals }: { q: string; first: Page<PaymentRow>; totals?: Totals }) {
  const m = useMore(q, 'payments', first, (r) => r.payments);
  const rows = m.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Section title="Payments" aside={totals && (
      <p className="text-xs text-gray-600">
        Paid {rupees(totals.paid.amount)} ({totals.paid.count}) · waiting {rupees(totals.waiting.amount)} ({totals.waiting.count})
        {totals.closed.count ? ` · ${totals.closed.count} declined or cancelled` : ''}
      </p>
    )}>
      {rows.length ? (
        <ul className="divide-y">{rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
            <Link href={`/admin/payments?view=all&q=${encodeURIComponent(p.number)}`} className="font-medium text-blue-700 hover:underline">{p.number}</Link>
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[p.status]}`}>{words(p.status)}</span>
            <span className="text-gray-900">{paymentMoney(p)}</span>
            <span className="min-w-0 flex-1 truncate text-gray-600">
              {p.kind === 'supplier' ? 'Supplier' : 'Expense'} · {p.payee} · {p.requestedBy} · {formatDateIST(p.createdAt)}
              {p.order ? ` · ${p.order.number}` : ''}{p.project ? ` · ${p.project.code}` : ''}{p.reference ? ` · ${p.reference}` : ''}
            </span>
          </li>
        ))}</ul>
      ) : <Empty>No payments.</Empty>}
      <MoreButton m={m} />
    </Section>
  );
}

function MoreButton({ m }: { m: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown; isError: boolean; error: unknown } }) {
  return (
    <>
      {m.isError && <p role="alert" className="mt-2 text-xs text-red-700">{errorMessage(m.error, 'Could not load more.')}</p>}
      {m.hasNextPage && (
        <button type="button" onClick={() => m.fetchNextPage()} disabled={m.isFetchingNextPage}
          className="mt-2 w-full rounded-lg border border-gray-300 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {m.isFetchingNextPage ? 'Loading…' : 'Show 20 more'}
        </button>
      )}
    </>
  );
}
