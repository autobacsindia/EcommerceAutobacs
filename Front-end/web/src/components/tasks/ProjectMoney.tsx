'use client';

/**
 * A project's "Money" box: what has been paid and what is still waiting, and
 * the payments linked to it (Back-end services/projectMoneyService.js).
 *
 * Every number here is the server's — the totals are never added up in the
 * browser. The server also decides who sees it (the admin, Accounts and the
 * project's owner) and refuses everyone else; the check below only saves a
 * request that would be refused, so a member never sees an empty box.
 */
import { useContext } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, Wallet } from 'lucide-react';
import apiClient from '@/lib/api-client';
import AuthContext from '@/context/AuthContext';
import { taskKeys } from '@/hooks/queries/keys';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage, paymentMoney, rupees, STATUS_TONE, type PaymentStatus } from '@/components/payments/api';
import type { Project } from './types';

export type MoneyRow = {
  id: string;
  number: string;
  kind: 'supplier' | 'expense';
  status: PaymentStatus;
  category: string;
  categoryLabel: string;
  purpose: string;
  amount: number;
  currency: string;
  foreignAmount: number | null;
  payee: string;
  createdAt: string;
  paidAt: string | null;
  /** Whether this person may open the payment itself (their team's, or Accounts / the admin). */
  canOpen: boolean;
};
export type MoneyTotals = {
  paid: { count: number; amount: number };
  waiting: { count: number; amount: number };
  closed: { count: number };
};
export type MoneyPage = {
  project?: { id: string; code: string | null; name: string; archived: boolean };
  totals?: MoneyTotals;
  payments: { items: MoneyRow[]; nextCursor: string | null };
};

const STATUS_WORDS: Record<PaymentStatus, string> = {
  submitted: 'Waiting', approved: 'Approved', on_hold: 'On hold', paid: 'Paid', declined: 'Declined', cancelled: 'Cancelled',
};

type Viewer = { _id: string; role: string; staff?: { team?: string | null; active?: boolean } | null } | null;

/** The same people the server lets in; anyone else gets no box (and no request). */
export const mayShowMoney = (user: Viewer, p: Pick<Project, 'owner'>) => !!user && (
  user.role === 'admin'
  || (user.role === 'staff' && user.staff?.team === 'accounts')
  || (user.role === 'staff' && user.staff?.active !== false && user._id === p.owner.id)
);

/** Opens the payment on the Payments page, under "All" — a paid one is not in the default "To pay" list. */
export const paymentHref = (row: Pick<MoneyRow, 'number'>, isAdmin: boolean) => (isAdmin
  ? `/admin/payments?view=all&status=all&q=${encodeURIComponent(row.number)}`
  : `/team/payments?status=all&q=${encodeURIComponent(row.number)}`);

export function useProjectMoney(projectId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: taskKeys.projectMoney(projectId),
    queryFn: ({ pageParam }) => apiClient.get<MoneyPage>(
      `/staff/tasks/projects/${encodeURIComponent(projectId)}/payments${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
    ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.payments.nextCursor || undefined,
    enabled,
    // Money moves outside this page (Accounts approves, the admin pays): always re-read on open.
    staleTime: 0,
  });
}

export function ProjectMoney({ p, isAdmin }: { p: Project; isAdmin: boolean }) {
  // Read softly: with no signed-in context (a preview, a test) the box is simply not shown.
  const user = useContext(AuthContext)?.user ?? null;
  const show = mayShowMoney(user as Viewer, p);
  const q = useProjectMoney(p.id, show);
  if (!show) return null;

  const first = q.data?.pages[0];
  const totals = first?.totals;
  const rows = q.data?.pages.flatMap((pg) => pg.payments.items) ?? [];

  return (
    <section aria-label="Money" className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Wallet aria-hidden className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">Money</h3>
        <span className="text-xs text-gray-500">Payments linked to {p.code || 'this project'}</span>
      </div>

      {q.isPending ? (
        <div role="status" aria-label="Loading money" className="mt-3 h-16 animate-pulse rounded-lg bg-gray-100" />
      ) : q.isError && !first ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMessage(q.error, 'Could not load this project’s payments.')}
        </p>
      ) : (
        <>
          {totals && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <p className="text-lg font-semibold tabular-nums text-emerald-900" data-testid="money-spent">
                  Spent {rupees(totals.paid.amount)}
                </p>
                <p className="text-xs text-emerald-800">{totals.paid.count} {totals.paid.count === 1 ? 'payment' : 'payments'} paid</p>
              </div>
              <div className="rounded-lg bg-amber-50 px-3 py-2">
                <p className="text-lg font-semibold tabular-nums text-amber-900" data-testid="money-waiting">
                  Waiting {rupees(totals.waiting.amount)}
                </p>
                <p className="text-xs text-amber-800">
                  {totals.waiting.count} not paid yet{totals.closed.count ? ` · ${totals.closed.count} declined or cancelled` : ''}
                </p>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-600">
              No payments yet. When someone raises an expense or a supplier payment, they can type {p.code || 'this project’s ID'} in its Project box and it shows here.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100" aria-label="Linked payments">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
                  <span className="w-20 shrink-0 text-xs text-gray-500">{formatDateIST(r.createdAt)}</span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-gray-900" title={r.purpose || undefined}>{r.purpose || r.payee || '—'}</span>
                    <span className="block truncate text-xs text-gray-500">{r.categoryLabel} · {r.payee}</span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[r.status]}`}>{STATUS_WORDS[r.status] ?? r.status}</span>
                  <span className="shrink-0 whitespace-nowrap text-right font-medium tabular-nums text-gray-900 sm:w-28">{paymentMoney(r)}</span>
                  {r.canOpen ? (
                    <Link href={paymentHref(r, isAdmin)} className="shrink-0 whitespace-nowrap text-right text-xs font-medium text-blue-700 hover:underline">
                      Open {r.number}
                    </Link>
                  ) : <span className="shrink-0 whitespace-nowrap text-right text-xs text-gray-400">{r.number}</span>}
                </li>
              ))}
            </ul>
          )}

          {q.isFetchNextPageError && <p role="alert" className="mt-2 text-xs text-red-700">{errorMessage(q.error, 'Could not load more.')}</p>}
          {q.hasNextPage && (
            <button
              type="button"
              onClick={() => q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {q.isFetchingNextPage && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />} Show more
            </button>
          )}
        </>
      )}
    </section>
  );
}
