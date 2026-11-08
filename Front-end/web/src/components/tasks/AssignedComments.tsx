'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Lock, MessageSquareText, RefreshCw, RotateCcw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { timeAgo } from './Comments';
import type { AssignedComment, AssignedCommentPage } from './types';

type State = 'open' | 'resolved';

/** The comments given to you, newest first; Resolve takes one off the list. */
export function AssignedComments({ onOpen }: { onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>('open');
  const pages = useInfiniteQuery({
    queryKey: taskKeys.assignedComments(state),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ state, ...(pageParam ? { before: pageParam } : {}) });
      return apiClient.get<AssignedCommentPage>(`/staff/tasks/assigned-comments?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextBefore || undefined,
    staleTime: 0,
  });
  // Server-confirmed: the row stays until the answer comes back.
  const resolve = useMutation({
    mutationFn: ({ c, resolved }: { c: AssignedComment; resolved: boolean }) => apiClient.put(
      `/staff/tasks/${encodeURIComponent(c.task.id)}/comments/${encodeURIComponent(c.id)}/resolved`,
      { resolved },
    ),
    onSuccess: (_r, { c }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.allAssignedComments() });
      queryClient.invalidateQueries({ queryKey: taskKeys.summary() });
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(c.task.id) });
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not update the comment.')),
  });
  const rows = pages.data?.pages.flatMap((p) => p.comments) ?? [];
  const tab = (value: State, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={state === value}
      onClick={() => setState(value)}
      className={`rounded-md px-2.5 py-1 text-sm font-medium ${state === value ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`}
    >{label}</button>
  );

  return (
    <section aria-label="Assigned comments" className="space-y-3">
      <div role="tablist" aria-label="Which comments" className="flex gap-1">{tab('open', 'To do')}{tab('resolved', 'Resolved')}</div>
      {pages.isPending ? (
        <div role="status" aria-label="Loading" className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />)}</div>
      ) : pages.isError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load your comments.
          <button type="button" onClick={() => pages.refetch()} className="ml-2 inline-flex items-center gap-1 font-medium underline"><RefreshCw aria-hidden className="h-3.5 w-3.5" />Try again</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center">
          <MessageSquareText aria-hidden className="mx-auto h-6 w-6 text-gray-400" />
          <p className="mt-2 text-sm font-medium text-gray-800">{state === 'open' ? 'No comments waiting for you' : 'Nothing resolved yet'}</p>
          {state === 'open' && <p className="mt-0.5 text-[13px] text-gray-500">When someone assigns you a comment on a task, it shows here until you resolve it.</p>}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                {c.canOpen ? (
                  <>
                    <button type="button" onClick={() => onOpen(c.task.id)} className="block max-w-full truncate text-left text-sm font-medium text-gray-900 hover:underline">
                      <span className="text-gray-500">{c.task.code}</span> · {c.task.title}
                    </button>
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-sm text-gray-700">{c.text || 'Shared a file'}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {c.by?.name} wrote this · assigned by {c.assignedBy || 'someone'} <time title={formatDateTimeIST(c.at)}>{timeAgo(c.at)}</time>
                    </p>
                  </>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm text-gray-500"><Lock aria-hidden className="h-3.5 w-3.5" />You can no longer open this task.</p>
                )}
              </div>
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ c, resolved: state === 'open' })}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {state === 'open' ? <><Check aria-hidden className="h-3.5 w-3.5" />Resolve</> : <><RotateCcw aria-hidden className="h-3.5 w-3.5" />Reopen</>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pages.hasNextPage && (
        <button type="button" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()} className="w-full rounded-md border border-gray-200 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {pages.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  );
}
