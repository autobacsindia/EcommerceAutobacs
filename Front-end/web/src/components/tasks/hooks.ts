'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { isConflict, newClientId, type Task, type TaskBucket, type TaskFilters, type TaskPage, type TaskStatus } from './types';

/** The query string for one list: only the filters that are set. */
export function listParams(filters: TaskFilters, state: TaskBucket): Record<string, string> {
  const p: Record<string, string> = { view: filters.view, state };
  if (state === 'open' && filters.due) p.due = filters.due;
  if (filters.priority) p.priority = filters.priority;
  if (filters.q?.trim()) p.q = filters.q.trim();
  if (filters.view === 'team' && filters.assignee) p.assignee = filters.assignee;
  return p;
}

/** One list (open, done or archived), keyset-paged; list and board share the cache. */
export function useTaskPages(filters: TaskFilters, state: TaskBucket, enabled = true) {
  const params = listParams(filters, state);
  return useInfiniteQuery({
    queryKey: taskKeys.list(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<TaskPage>(`/staff/tasks?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
    enabled,
  });
}

/** After any change: every list and the header counts reload. */
export function useRefreshTasks() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.summary() }),
  ]);
}

/** Move a task to another status, against the revision it was shown at. */
export function useSetStatus() {
  const refresh = useRefreshTasks();
  return useMutation({
    mutationFn: ({ t, status }: { t: Task; status: TaskStatus }) =>
      apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(t.id)}`, { rev: t.rev, status }),
    onSuccess: (_r, { t, status }) => {
      if (status === 'done') toast.success(`${t.code} done`, { id: `done-${t.id}` });
    },
    onError: (e, { t }) => {
      toast.error(isConflict(e)
        ? `${t.code} was changed by someone else just now — refreshed.`
        : errorMessage(e, `Could not move ${t.code}.`));
    },
    onSettled: () => refresh(),
  });
}

/**
 * "+ Add task" inside a status group or board column: a title, Enter, done.
 * The task starts in that status and goes to `assigneeId` (or the person adding it).
 */
export function useQuickAdd() {
  const refresh = useRefreshTasks();
  return useMutation({
    mutationFn: ({ title, status, assigneeId }: { title: string; status: TaskStatus; assigneeId?: string }) =>
      apiClient.post<{ task: Task }>('/staff/tasks', {
        title,
        ...(status !== 'done' && status !== 'todo' ? { status } : {}),
        ...(assigneeId ? { assigneeIds: [assigneeId] } : {}),
        clientId: newClientId(),
      }),
    onSuccess: () => refresh(),
    onError: (e) => { toast.error(errorMessage(e, 'Could not add the task.')); },
  });
}
