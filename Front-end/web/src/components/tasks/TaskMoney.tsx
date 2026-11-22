'use client';

/**
 * A task's "Reimbursements" box: the payments linked to it (usually fuel / food
 * claims for a pickup), each with its status, and what they add up to
 * (Back-end services/taskMoneyService.js).
 *
 * Every number is the server's. The server decides who sees it (the admin,
 * Accounts, the task's creator and the people doing it); the check below only
 * saves a request that would be refused.
 */
import { useContext } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, Receipt } from 'lucide-react';
import apiClient from '@/lib/api-client';
import AuthContext from '@/context/AuthContext';
import { taskKeys } from '@/hooks/queries/keys';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage, paymentMoney, rupees, STATUS_TONE } from '@/components/payments/api';
import { paymentHref, type MoneyRow, type MoneyTotals } from './ProjectMoney';
import type { Task } from './types';

export type TaskMoneyRow = MoneyRow & { requestedBy: string; claim: string };
export type TaskMoneyPage = {
  task?: { id: string; code: string; title: string };
  totals?: MoneyTotals;
  payments: { items: TaskMoneyRow[]; nextCursor: string | null };
};

const STATUS_WORDS: Record<string, string> = {
  submitted: 'Waiting for accounts', approved: 'Approved', on_hold: 'On hold', paid: 'Paid', declined: 'Declined', cancelled: 'Cancelled',
};

type Viewer = { _id: string; role: string; staff?: { team?: string | null; active?: boolean } | null } | null;

/** The same people the server lets in. */
export const mayShowTaskMoney = (user: Viewer, t: Pick<Task, 'createdBy' | 'assignees'>) => !!user && (
  user.role === 'admin'
  || (user.role === 'staff' && user.staff?.team === 'accounts')
  || (user.role === 'staff' && user.staff?.active !== false
    && (user._id === t.createdBy.id || (t.assignees || []).some((a) => a.id === user._id)))
);

export function TaskMoney({ task }: { task: Task }) {
  const user = useContext(AuthContext)?.user ?? null;
  const isAdmin = user?.role === 'admin';
  const show = mayShowTaskMoney(user as Viewer, task);
  const q = useInfiniteQuery({
    queryKey: taskKeys.taskMoney(task.id),
    queryFn: ({ pageParam }) => apiClient.get<TaskMoneyPage>(
      `/staff/tasks/${encodeURIComponent(task.id)}/payments${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
    ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.payments.nextCursor || undefined,
    enabled: show,
    // Accounts approves and the admin pays elsewhere: always re-read on open.
    staleTime: 0,
  });
  if (!show) return null;

  const first = q.data?.pages[0];
  const totals = first?.totals;
  const rows = q.data?.pages.flatMap((pg) => pg.payments.items) ?? [];
  return (
    <section aria-label="Reimbursements">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Receipt aria-hidden className="h-4 w-4 text-gray-500" /> Reimbursements
        {totals && (totals.paid.count + totals.waiting.count) > 0 && (
          <span className="text-xs font-normal text-gray-500" data-testid="task-money-totals">
            · paid {rupees(totals.paid.amount)} · waiting {rupees(totals.waiting.amount)}
          </span>
        )}
      </h3>
      {q.isPending ? (
        <div role="status" aria-label="Loading reimbursements" className="h-10 animate-pulse rounded-lg bg-gray-100" />
      ) : q.isError && !first ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMessage(q.error, 'Could not load this task’s reimbursements.')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          None yet. Spent money on this task (fuel, food, transport)? Raise a Reimbursement in Payments and pick {task.code} as its task.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100" aria-label="Linked payments">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 basis-40">
                <span className="block truncate text-gray-900">{r.claim || r.categoryLabel}</span>
                <span className="block truncate text-xs text-gray-500">{r.requestedBy} · {formatDateIST(r.createdAt)}{r.purpose ? ` · ${r.purpose}` : ''}</span>
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[r.status]}`}>{STATUS_WORDS[r.status] ?? r.status}</span>
              <span className="shrink-0 whitespace-nowrap text-right font-medium tabular-nums text-gray-900 sm:w-24">{paymentMoney(r)}</span>
              {r.canOpen ? (
                <Link href={paymentHref(r, isAdmin)} className="shrink-0 whitespace-nowrap text-xs font-medium text-blue-700 hover:underline">{r.number}</Link>
              ) : <span className="shrink-0 whitespace-nowrap text-xs text-gray-400">{r.number}</span>}
            </li>
          ))}
        </ul>
      )}
      {q.isFetchNextPageError && <p role="alert" className="mt-2 text-xs text-red-700">{errorMessage(q.error, 'Could not load more.')}</p>}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
          {q.isFetchingNextPage && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />} Show more
        </button>
      )}
    </section>
  );
}
