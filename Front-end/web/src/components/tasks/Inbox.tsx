'use client';

import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AtSign, CheckCheck, Circle, CircleCheck, Lock, MessageSquare, Network, RefreshCw, UserPlus, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { notificationKeys, taskKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { timeAgo } from './Comments';
import { Avatar } from './ui';
import { formatDueDay, todayIST, unreadLabel, type InboxFilter, type InboxItem, type InboxKind, type InboxPage } from './types';

type Pages = InfiniteData<InboxPage, string>;

/** Your Inbox, newest first, 30 lines a page (the workspace reads the same cache for J / K). */
export function useInboxPages(filter: InboxFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: taskKeys.inbox(filter),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ state: filter, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<InboxPage>(`/staff/tasks/inbox?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
    enabled,
  });
}

/** The tasks behind the lines, in order, once each — only those that still open. */
export const inboxOrder = (pages: { pages: InboxPage[] } | undefined) =>
  [...new Set((pages?.pages ?? []).flatMap((p) => p.items).filter((i) => i.canOpen).map((i) => i.task.id))];

/*
  Read, unread and Clear change the screen at once and put it back if the server
  says no: an Inbox line is nobody's money, so waiting for the round trip would
  only make the screen feel slow. "Mark all read" too, up to the newest line
  shown. The count on each page comes from the server's answer, never guessed.
*/
function useInboxChanges() {
  const queryClient = useQueryClient();
  const edit = (fn: (items: InboxItem[]) => InboxItem[], unread?: number) => queryClient.setQueriesData<Pages>(
    { queryKey: taskKeys.inboxes() },
    (old) => old && {
      ...old,
      pages: old.pages.map((p) => ({ ...p, items: fn(p.items), ...(unread !== undefined ? { unread } : {}) })),
    },
  );
  const snapshot = async () => {
    await queryClient.cancelQueries({ queryKey: taskKeys.inboxes() });
    return queryClient.getQueriesData<Pages>({ queryKey: taskKeys.inboxes() });
  };
  const restore = (saved?: Awaited<ReturnType<typeof snapshot>>) => saved?.forEach(([key, data]) => queryClient.setQueryData(key, data));
  // The bell and the sidebar badge poll on their own; this brings their numbers in line now.
  const bell = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: notificationKeys.summary() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.summary() }),
  ]);

  const setState = useMutation({
    mutationFn: ({ item, state }: { item: InboxItem; state: 'read' | 'unread' | 'cleared' }) =>
      apiClient.patch<{ id: string; state: string; unread: number }>(`/staff/tasks/inbox/${encodeURIComponent(item.id)}`, { state }),
    onMutate: async ({ item, state }) => {
      const saved = await snapshot();
      edit((items) => (state === 'cleared'
        ? items.filter((i) => i.id !== item.id)
        : items.map((i) => (i.id === item.id ? { ...i, read: state === 'read' } : i))));
      return saved;
    },
    onError: (e, { state }, saved) => {
      restore(saved);
      toast.error(errorMessage(e, state === 'cleared' ? 'Could not clear that line.' : 'Could not update that line.'));
    },
    onSuccess: (res) => edit((items) => items, res.unread),
    onSettled: bell,
  });

  const readAll = useMutation({
    mutationFn: (upTo: string) => apiClient.post<{ marked: number; unread: number }>('/staff/tasks/inbox/read-all', { upTo }),
    onMutate: async (upTo) => {
      const saved = await snapshot();
      // Ids are ObjectIds: same length, and hex order is time order.
      edit((items) => items.map((i) => (i.id <= upTo ? { ...i, read: true } : i)));
      return saved;
    },
    onError: (e, _upTo, saved) => { restore(saved); toast.error(errorMessage(e, 'Could not mark them read.')); },
    onSuccess: (res) => edit((items) => items, res.unread),
    onSettled: bell,
  });

  return { setState, readAll };
}

const KIND: Record<InboxKind, { icon: typeof AtSign; tone: string; say: (code: string) => string; quote: boolean }> = {
  assigned: { icon: UserPlus, tone: 'bg-blue-100 text-blue-700', say: (c) => `gave you ${c}`, quote: false },
  status: { icon: CircleCheck, tone: 'bg-emerald-100 text-emerald-700', say: (c) => `moved ${c}`, quote: false },
  comment: { icon: MessageSquare, tone: 'bg-gray-100 text-gray-600', say: (c) => `commented on ${c}`, quote: true },
  mention: { icon: AtSign, tone: 'bg-violet-100 text-violet-700', say: (c) => `mentioned you on ${c}`, quote: true },
  subtask: { icon: Network, tone: 'bg-amber-100 text-amber-700', say: (c) => `added a sub-task to ${c}`, quote: false },
};

/** What follows the sentence: the status it moved to, the due day, the words, the sub-task. */
function detailOf(item: InboxItem) {
  if (!item.text) return null;
  if (item.kind === 'status') return <>to <strong className="font-semibold">{item.text}</strong></>;
  if (KIND[item.kind].quote) return <span className="italic">“{item.text}”</span>;
  // The server writes the day as it is stored ("due 2026-11-20"); say it as the panel does.
  const due = /^due (\d{4}-\d{2}-\d{2})$/.exec(item.text);
  if (due) return `Due ${formatDueDay(due[1])}`;
  return item.text;
}

/** "Today", "Yesterday", or "Earlier" — by the day in India, as everywhere in the panel. */
function dayGroup(at: string, today: string) {
  const day = todayIST(new Date(at));
  if (day === today) return 'Today';
  const yesterday = todayIST(new Date(new Date(`${today}T12:00:00+05:30`).getTime() - 86_400_000));
  return day === yesterday ? 'Yesterday' : 'Earlier';
}

function InboxLine({ item, active, onOpen, onState }: {
  item: InboxItem;
  active: boolean;
  onOpen: (taskId: string) => void;
  onState: (state: 'read' | 'unread' | 'cleared') => void;
}) {
  const k = KIND[item.kind];
  const Icon = k.icon;
  const who = item.by?.name || 'Someone';
  const detail = detailOf(item);
  const body = (
    <>
      <span className="relative mt-0.5 shrink-0">
        {item.by ? <Avatar name={who} id={item.by.id} /> : <span className="block h-7 w-7 rounded-full bg-gray-200" />}
        <span className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white ${k.tone}`}>
          <Icon aria-hidden className="h-2.5 w-2.5" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${item.read ? 'text-gray-600' : 'text-gray-900'}`}>
          <span className={item.read ? 'font-medium' : 'font-semibold'}>{who}</span> {k.say(item.task.code)}
          {item.kind !== 'status' && <> · <span className={item.read ? '' : 'font-medium'}>{item.task.title}</span></>}
          {item.kind === 'status' && <> {detail}</>}
        </span>
        {item.kind === 'status' && <span className="block truncate text-xs text-gray-500">{item.task.title}</span>}
        {item.kind !== 'status' && detail && <span className="block truncate text-xs text-gray-500">{detail}</span>}
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
          <time dateTime={item.at} title={formatDateTimeIST(item.at)}>{timeAgo(item.at)}</time>
          {!item.canOpen && <><span aria-hidden>·</span><Lock aria-hidden className="h-3 w-3" /> You no longer have access</>}
        </span>
      </span>
    </>
  );
  return (
    <li className={`group flex items-start gap-1 border-l-2 pr-1.5 transition-colors ${
      // Unread: the blue edge, the dot and the bold words — no tint, which turns muddy in the dark theme.
      active ? 'border-blue-500 bg-gray-50' : item.read ? 'border-transparent hover:bg-gray-50' : 'border-blue-500 hover:bg-gray-50'
    }`}>
      {item.canOpen ? (
        <button
          type="button"
          onClick={() => onOpen(item.task.id)}
          className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-3 text-left"
          aria-label={`${who} ${k.say(item.task.code)}: ${item.task.title}${item.read ? '' : ' (unread)'}`}
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-3 opacity-70" aria-disabled="true">{body}</div>
      )}
      <span className="flex shrink-0 items-center gap-0.5 pt-2.5">
        {!item.read && <span aria-hidden className="mr-1 h-2 w-2 rounded-full bg-blue-600 group-hover:hidden group-focus-within:hidden" />}
        <button
          type="button"
          onClick={() => onState(item.read ? 'unread' : 'read')}
          aria-label={item.read ? `Mark ${item.task.code} update unread` : `Mark ${item.task.code} update read`}
          title={item.read ? 'Mark unread' : 'Mark read'}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 sm:hidden sm:group-hover:inline-flex sm:group-focus-within:inline-flex"
        >
          {item.read ? <Circle className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => onState('cleared')}
          aria-label={`Clear ${item.task.code} update`}
          title="Clear"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 sm:hidden sm:group-hover:inline-flex sm:group-focus-within:inline-flex"
        >
          <X className="h-4 w-4" />
        </button>
      </span>
    </li>
  );
}

/**
 * The Inbox: one line per thing that happened on your tasks — a task given to
 * you, a status change, a comment or @mention, a sub-task added. Opening a line
 * opens the task, and the task's unread lines become read.
 */
export default function Inbox({ filter, onFilter, openId, onOpen }: {
  filter: InboxFilter;
  onFilter: (f: InboxFilter) => void;
  /** The task open in the window, if any: its unread lines are read. */
  openId: string | null;
  onOpen: (taskId: string) => void;
}) {
  const q = useInboxPages(filter);
  const { setState, readAll } = useInboxChanges();
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const unread = q.data?.pages[0]?.unread ?? 0;

  // Opening a task (a click, or J / K) reads its lines — each line once, however often it renders.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!openId) return;
    for (const i of items) {
      if (i.task.id !== openId || i.read || asked.current.has(i.id)) continue;
      asked.current.add(i.id);
      setState.mutate({ item: i, state: 'read' }, { onError: () => asked.current.delete(i.id) });
    }
  }, [openId, items, setState]);

  // A second click lands before the button re-renders disabled: this stops it at once.
  const markingAll = useRef(false);
  const markAll = () => {
    if (!items[0] || markingAll.current) return;
    markingAll.current = true;
    readAll.mutate(items[0].id, { onSettled: () => { markingAll.current = false; } });
  };

  const today = todayIST();
  let lastGroup = '';
  const tab = (value: InboxFilter, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={filter === value}
      onClick={() => onFilter(value)}
      className={`h-7 rounded px-2.5 text-[13px] font-medium transition ${filter === value ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`}
    >
      {label}
    </button>
  );

  return (
    <section aria-label="Inbox" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Which updates" className="flex gap-0.5 rounded-md border border-gray-200 bg-white p-0.5">
          {tab('all', 'All')}
          {tab('unread', unread > 0 ? `Unread (${unreadLabel(unread)})` : 'Unread')}
        </div>
        <button
          type="button"
          onClick={markAll}
          disabled={!unread || !items.length || readAll.isPending}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <CheckCheck aria-hidden className="h-4 w-4" /> Mark all read
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {q.isLoading ? (
          <ul aria-hidden className="animate-pulse divide-y divide-gray-100">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex gap-3 px-3 py-3">
                <span className="h-7 w-7 rounded-full bg-gray-100" />
                <span className="flex-1 space-y-1.5"><span className="block h-3.5 w-2/3 rounded bg-gray-100" /><span className="block h-3 w-1/3 rounded bg-gray-100" /></span>
              </li>
            ))}
          </ul>
        ) : q.isError && !items.length ? (
          <p role="alert" className="flex items-center justify-between gap-2 px-3 py-4 text-sm text-red-600">
            {errorMessage(q.error, 'Could not load your inbox.')}
            <button type="button" onClick={() => q.refetch()} className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline">
              <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Try again
            </button>
          </p>
        ) : !items.length ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-gray-900">{filter === 'unread' ? 'You’re all caught up' : 'Nothing here yet'}</p>
            <p className="mt-1 text-sm text-gray-500">
              {filter === 'unread'
                ? 'No unread updates on your tasks.'
                : 'When someone gives you a task, moves one, comments or mentions you, it shows up here.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((item) => {
              const group = dayGroup(item.at, today);
              const heading = group !== lastGroup;
              lastGroup = group;
              return [
                heading && (
                  <li key={`h-${group}`} role="presentation" className="bg-gray-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                    {group}
                  </li>
                ),
                <InboxLine
                  key={item.id}
                  item={item}
                  active={item.task.id === openId}
                  onOpen={onOpen}
                  onState={(state) => setState.mutate({ item, state })}
                />,
              ];
            })}
          </ul>
        )}
        {q.hasNextPage && (
          <div className="border-t border-gray-100 px-3 py-2 text-center">
            {q.isFetchNextPageError && <p role="alert" className="mb-1 text-sm text-red-600">Could not load more.</p>}
            <button
              type="button"
              onClick={() => q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
              className="text-sm font-medium text-blue-700 hover:underline disabled:opacity-50"
            >
              {q.isFetchingNextPage ? 'Loading…' : q.isFetchNextPageError ? 'Try again' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
