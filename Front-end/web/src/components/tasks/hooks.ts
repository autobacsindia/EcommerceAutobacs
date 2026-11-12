'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import {
  isConflict, newClientId, type BulkChange, type BulkResult, type Task, type TaskBucket, type TaskFilters, type TaskPage, type TaskPriority, type TaskStatus,
} from './types';

/** The query string for one list: only the filters that are set. */
export function listParams(filters: TaskFilters, state: TaskBucket): Record<string, string> {
  const p: Record<string, string> = { view: filters.view, state };
  if (state === 'open' && filters.due) p.due = filters.due;
  if (filters.priority) p.priority = filters.priority;
  if (filters.q?.trim()) p.q = filters.q.trim();
  if ((filters.view === 'team' || filters.view === 'project') && filters.assignee) p.assignee = filters.assignee;
  if (filters.view === 'project' && filters.project) p.project = filters.project;
  if (filters.view === 'team' && filters.team) p.team = filters.team;
  if (filters.view === 'team' && filters.list) p.list = filters.list;
  if (filters.tag) p.tag = filters.tag;
  if (state === 'open' && filters.sort && filters.sort !== 'due') p.sort = filters.sort;
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

/** After any change: every list, the header counts and the sidebar's list counts reload. */
export function useRefreshTasks() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.summary() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.spaces() }),
    // Project cards count their tasks: any task change may move a progress bar.
    queryClient.invalidateQueries({ queryKey: taskKeys.projects() }),
  ]);
}

/** Move a task to another status, against the revision it was shown at. */
export function useSetStatus() {
  const refresh = useRefreshTasks();
  return useMutation({
    mutationFn: ({ t, status }: { t: Task; status: TaskStatus }) =>
      apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(t.id)}`, { rev: t.rev, status }),
    onSuccess: (_r, { t, status }) => {
      if (status === 'done') toast.success(`${t.code} complete`, { id: `done-${t.id}` });
    },
    onError: (e, { t }) => {
      toast.error(isConflict(e)
        ? `${t.code} was changed by someone else just now — refreshed.`
        : errorMessage(e, `Could not move ${t.code}.`));
    },
    onSettled: () => refresh(),
  });
}

/** What a card's quick buttons may change in place. */
export type QuickEdit = { dueOn?: string | null; priority?: TaskPriority; assigneeIds?: string[] };

/**
 * Change one thing on a task from its card (date, priority, people), against the
 * revision it was shown at. Nothing on screen changes until the server says yes;
 * a refusal says why and reloads, so the card never shows what was not saved.
 */
export function useQuickEdit() {
  const refresh = useRefreshTasks();
  return useMutation({
    mutationFn: ({ t, patch }: { t: Task; patch: QuickEdit }) =>
      apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(t.id)}`, { rev: t.rev, ...patch }),
    onSuccess: (_r, { t }) => { toast.success(`${t.code} saved`, { id: `quick-${t.id}`, duration: 1500 }); },
    onError: (e, { t }) => {
      toast.error(isConflict(e)
        ? `${t.code} was changed by someone else just now — refreshed.`
        : errorMessage(e, `Could not change ${t.code}.`));
    },
    onSettled: () => refresh(),
  });
}

/** What "+ Add task" may set beside the title (the board's chips). */
export type QuickExtras = { assigneeIds?: string[]; dueOn?: string | null; priority?: TaskPriority; tags?: string[]; listId?: string; projectId?: string; personal?: boolean };

/**
 * "+ Add task" inside a status group or board column: a title, Enter, done.
 * The task starts in that status and goes to `assigneeId` / `assigneeIds` (or
 * the person adding it); several people share ONE task. `clientId` is per
 * draft, so a double Enter or a retried request still makes one task.
 */
export function useQuickAdd() {
  const refresh = useRefreshTasks();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ title, status, assigneeId, extras = {}, clientId = newClientId() }: {
      title: string; status: TaskStatus; assigneeId?: string; extras?: QuickExtras; clientId?: string;
    }) => {
      const ids = extras.assigneeIds?.length ? extras.assigneeIds : assigneeId ? [assigneeId] : [];
      return apiClient.post<{ task: Task }>('/staff/tasks', {
        title,
        ...(status !== 'done' && status !== 'todo' ? { status } : {}),
        ...(ids.length ? { assigneeIds: ids, shared: true } : {}),
        ...(extras.dueOn ? { dueOn: extras.dueOn } : {}),
        ...(extras.priority && extras.priority !== 'normal' ? { priority: extras.priority } : {}),
        ...(extras.tags?.length ? { tags: extras.tags } : {}),
        ...(extras.listId ? { listId: extras.listId } : {}),
        ...(extras.projectId ? { projectId: extras.projectId } : {}),
        ...(extras.personal ? { personal: true } : {}),
        clientId,
      });
    },
    onSuccess: () => {
      // Whoever was just picked moves up the people picker.
      queryClient.invalidateQueries({ queryKey: taskKeys.assignees() });
      return refresh();
    },
    onError: (e) => { toast.error(errorMessage(e, 'Could not add the task.')); },
  });
}

/**
 * The same change on the selected tasks. Each task is checked on its own by the
 * server; the toast says how many changed and, by code, which were refused.
 */
export function useBulkUpdate() {
  const refresh = useRefreshTasks();
  return useMutation({
    mutationFn: ({ tasks, changes }: { tasks: Task[]; changes: BulkChange }) =>
      apiClient.post<BulkResult>('/staff/tasks/bulk', { items: tasks.map((t) => ({ id: t.id, rev: t.rev })), changes }),
    onSuccess: (res, { tasks }) => {
      const code = new Map(tasks.map((t) => [t.id, t.code]));
      const done = res.changed + res.unchanged;
      if (res.failed === 0) {
        toast.success(`${done} task${done === 1 ? '' : 's'} updated`, { id: 'tasks-bulk' });
        return;
      }
      const refused = res.results.filter((r) => !r.ok);
      const why = refused.slice(0, 3).map((r) => `${code.get(r.id) ?? 'A task'}: ${r.error}`).join('\n');
      toast.error(`${done} updated, ${res.failed} not changed.\n${why}${refused.length > 3 ? '\n…' : ''}`, { id: 'tasks-bulk', duration: 8000 });
    },
    onError: (e) => { toast.error(errorMessage(e, 'Could not change those tasks.')); },
    onSettled: () => refresh(),
  });
}

/**
 * Tags already used on the tasks this screen has loaded — the suggestions when
 * typing a tag. No extra request: read from the lists in the query cache.
 */
export function useKnownTags(): string[] {
  const queryClient = useQueryClient();
  const seen = new Set<string>();
  for (const [, data] of queryClient.getQueriesData<{ pages: TaskPage[] }>({ queryKey: taskKeys.lists() })) {
    for (const page of data?.pages ?? []) for (const t of page.tasks) for (const tag of t.tags ?? []) seen.add(tag);
  }
  return [...seen].sort();
}

/**
 * Follow / stop following a task, or (whoever gave it, a head, the admin) add
 * and remove followers. Never bumps the task's revision, so it never makes an
 * open edit stale. The answer is the task now — or null when the viewer stopped
 * following a task they could see only as a follower.
 */
export function useFollowers(taskId: string, { onGone }: { onGone?: () => void } = {}) {
  const queryClient = useQueryClient();
  const refresh = useRefreshTasks();
  return useMutation({
    mutationFn: (change: { add?: string[]; remove?: string[] }) =>
      apiClient.patch<{ task: Task | null }>(`/staff/tasks/${encodeURIComponent(taskId)}/followers`, change),
    onSuccess: (res) => {
      if (res.task) queryClient.setQueryData(taskKeys.one(taskId), { task: res.task });
      else { queryClient.removeQueries({ queryKey: taskKeys.one(taskId) }); onGone?.(); }
      // The mention list marks who is on the task.
      queryClient.invalidateQueries({ queryKey: [...taskKeys.one(taskId), 'mentionable'] });
      refresh();
    },
    onError: (e) => { toast.error(errorMessage(e, 'Could not change who follows this task.')); },
  });
}
