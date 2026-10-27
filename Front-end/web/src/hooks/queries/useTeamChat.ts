'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { submitMultipart, parseApiResponse } from '@/lib/multipartResponse';
import { useAuth } from '@/context/AuthContext';
import { chatKeys } from './keys';
import { pollInterval } from './useNotifications';

export interface ChatPerson {
  id: string;
  name: string;
  role: 'admin' | 'staff';
  team: string | null;
  teamLabel: string | null;
  isHead: boolean;
}

export interface ChatChannel {
  id: string;
  kind: 'space' | 'dm';
  key: string | null;
  name: string;
  description: string;
  /** 'teams': the private conversation between two whole teams. */
  audience: 'all' | 'team' | 'members' | 'teams';
  team: string | null;
  /** audience 'teams' only: the two teams. */
  teams?: string[] | null;
  /** audience 'teams' only: the OTHER team, from where I sit (null for admins). */
  withTeam?: string | null;
  system: boolean;
  partner: ChatPerson | null;
  memberCount: number | null;
  /** Custom group: may I add / remove members? (admin, or whoever created it) */
  canManageMembers?: boolean;
  lastMessageSeq: number;
  lastMessageAt: string | null;
  /** Read position of the Chat tab. */
  lastReadSeq: number;
  /** Read position of the Order updates tab (read separately from Chat). */
  lastReadUpdatesSeq?: number;
  /** Unread per tab; `unread` is their sum. Optional only for an older server. */
  unreadChat?: number;
  unreadUpdates?: number;
  unread: number;
  /** My notification setting here. Absent from an older server = 'all'. */
  notify?: NotifyLevel;
  /** On '@mentions only': the unread that @mentions me or my team. */
  unreadMentions?: number;
}

/** How loudly a conversation reaches me, as in Google Chat. */
export type NotifyLevel = 'all' | 'mentions' | 'off';

export const notifyOf = (c: ChatChannel): NotifyLevel => c.notify ?? 'all';

/**
 * What a conversation adds to my badges and chime: everything on "All", only
 * what @mentions me on "@mentions only", nothing on "Off". (Its own row still
 * shows the plain unread count, greyed — see TeamChat.)
 */
export function countedUnread(c: ChatChannel): { chat: number; updates: number } {
  const level = notifyOf(c);
  if (level === 'off') return { chat: 0, updates: 0 };
  if (level === 'mentions') return { chat: c.unreadMentions ?? 0, updates: 0 };
  return { chat: unreadChatOf(c), updates: unreadUpdatesOf(c) };
}

/** Which tab of a conversation a read applies to. */
export type ReadPart = 'chat' | 'updates';

/** Unread people's messages / order updates in a channel (an older server only sends `unread`). */
export const unreadChatOf = (c: ChatChannel) => c.unreadChat ?? c.unread;
export const unreadUpdatesOf = (c: ChatChannel) => c.unreadUpdates ?? 0;
export const readUpdatesSeqOf = (c: ChatChannel) => c.lastReadUpdatesSeq ?? c.lastReadSeq;

export interface ChatAttachment {
  url: string;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  size: number;
}

export interface ChatRef {
  type: 'order';
  code: string;
  id: string;
}

export interface ChatFile extends ChatAttachment {
  id: string;
  messageId: string;
  sharedBy: ChatPerson | null;
  sharedAt: string;
}

export interface RecentOrder {
  id: string;
  code: string;
  customer: string;
  total: number;
  status: string;
  placedAt: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  seq: number;
  kind: 'user' | 'system';
  text: string;
  deleted: boolean;
  sender: ChatPerson | null;
  clientId: string | null;
  attachments: ChatAttachment[];
  mentions: string[];
  mentionTeams: string[];
  refs: ChatRef[];
  /** The message this one quotes, as it read when quoted. */
  quote?: ChatQuote | null;
  /** Emoji reactions, in the order each emoji was first used. */
  reactions?: ChatReaction[];
  createdAt: string;
  /** Set on a reply: the top-level message it belongs to. */
  threadRoot?: string | null;
  /** Top-level only: the seq of the newest thing in its thread — the timeline's order. */
  activitySeq?: number | null;
  replyCount?: number;
  lastReply?: ChatLastReply | null;
  /** Client-only: still being sent / failed to send. */
  pending?: boolean;
  failed?: boolean;
  /** The author changed the text after sending. */
  edited?: boolean;
  editedAt?: string | null;
  /**
   * Until when its author may still edit or delete it. Null on system posts and
   * deleted messages. A hint for the UI — the server enforces the real window.
   */
  editableUntil?: string | null;
  /** Admins only: the text before each edit, oldest first. */
  editHistory?: { text: string; editedAt: string }[];
  /** Admins only: when a deleted message was deleted. */
  deletedAt?: string;
}

/** One emoji on a message: how many people, and who (the people can see the channel). */
export interface ChatReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface ChatQuote {
  id: string;
  seq: number;
  by: string;
  /** Empty when the quoted message was since deleted (except for admins). */
  preview: string;
  deleted?: boolean;
}

export interface ChatLastReply {
  at: string;
  by: string;
  preview: string;
  mentions: string[];
}

/** Where a top-level message sits in the timeline. Pending sends go last. */
const orderOf = (m: ChatMessage) => (m.pending ? Infinity : m.activitySeq ?? m.seq);

export interface MessagePage {
  messages: ChatMessage[];
  nextBefore: number | null;
}

/** True for accounts that may use team chat (the API enforces the same rule). */
export function useCanChat(): boolean {
  const { user } = useAuth();
  return !!user && (user.role === 'admin' || (user.role === 'staff' && !!user.staff));
}

export function useChatChannels(options: { poll?: boolean } = {}) {
  const enabled = useCanChat();
  return useQuery({
    queryKey: chatKeys.channels(),
    queryFn: async () => (await apiClient.get<{ channels: ChatChannel[] }>('/chat/channels')).channels ?? [],
    enabled,
    staleTime: 15_000,
    // Nav badges poll; the open chat page is kept fresh by the live stream instead.
    // They keep polling (slower) in a hidden tab, so the chat sound still plays
    // for someone in another tab or app — see useNotifications.ts.
    refetchInterval: options.poll ? pollInterval(30_000) : false,
    refetchIntervalInBackground: !!options.poll,
  });
}

/** Total unread across every channel — for the "Chat" nav badge. Muted conversations do not count. */
export function useChatUnreadTotal(): number {
  const { data } = useChatChannels({ poll: true });
  return (data ?? []).reduce((n, c) => { const u = countedUnread(c); return n + u.chat + u.updates; }, 0);
}

/**
 * Unread split by tab, for the bell: people's messages, and order updates with
 * the space that most recently got one (where "Unread order updates" opens).
 */
export function useChatUnreadSplit(): { chat: number; updates: number; updatesChannelId: string | null } {
  const { data } = useChatChannels({ poll: true });
  const list = data ?? [];
  const withUpdates = list
    .filter((c) => countedUnread(c).updates > 0)
    .sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
  return {
    chat: list.reduce((n, c) => n + countedUnread(c).chat, 0),
    updates: list.reduce((n, c) => n + countedUnread(c).updates, 0),
    updatesChannelId: withUpdates[0]?.id ?? null,
  };
}

export function useChatPeople(enabled = true) {
  const canChat = useCanChat();
  return useQuery({
    queryKey: chatKeys.people(),
    queryFn: async () => (await apiClient.get<{ people: ChatPerson[] }>('/chat/people')).people ?? [],
    enabled: enabled && canChat,
    staleTime: 5 * 60_000,
  });
}

export function useChatMe() {
  const enabled = useCanChat();
  return useQuery({
    queryKey: chatKeys.me(),
    queryFn: () => apiClient.get<{ canCreateSpace: boolean; userId: string }>('/chat/me'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

const PAGE = 50;

export function useChatMessages(channelId: string | null) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(channelId ?? 'none'),
    queryFn: async ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (pageParam) q.set('before', String(pageParam));
      const res = await apiClient.get<MessagePage>(`/chat/channels/${channelId}/messages?${q}`);
      return { messages: res.messages ?? [], nextBefore: res.nextBefore ?? null };
    },
    initialPageParam: 0 as number,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: !!channelId,
    staleTime: Infinity, // the live stream keeps it current; reconnects catch up explicitly
  });
}

type Pages = InfiniteData<MessagePage, number>;

/** Insert or replace a message in the cached pages (newest page is pages[0]). */
export function upsertMessage(data: Pages | undefined, msg: ChatMessage): Pages | undefined {
  if (!data) return data;
  let found = false;
  const pages = data.pages.map((p) => {
    const i = p.messages.findIndex(
      (m) => m.id === msg.id || (!!msg.clientId && m.clientId === msg.clientId && (m.pending || m.failed)),
    );
    if (i === -1) return p;
    found = true;
    const next = p.messages.slice();
    next[i] = msg;
    return { ...p, messages: next };
  });
  if (found) return { ...data, pages };
  // A reply lives in its thread, never in the timeline (see applyThreadUpdate).
  if (msg.threadRoot) return data;
  const [first, ...rest] = pages;
  const merged = [...(first?.messages ?? []), msg].sort((a, b) => orderOf(a) - orderOf(b));
  return { ...data, pages: [{ ...(first ?? { nextBefore: null }), messages: merged }, ...rest] };
}

/**
 * A thread moved: replace its root wherever it is cached and bring it to the
 * newest page, so the conversation shows it at the bottom — the same order the
 * server's timeline gives. A root that is not loaded (older than every cached
 * page) is added too: it has just become the newest thing in the channel.
 */
export function applyThreadUpdate(data: Pages | undefined, root: ChatMessage): Pages | undefined {
  if (!data) return data;
  const pages = data.pages.map((p) => ({ ...p, messages: p.messages.filter((m) => m.id !== root.id) }));
  const [first, ...rest] = pages;
  const merged = [...(first?.messages ?? []), root].sort((a, b) => orderOf(a) - orderOf(b));
  return { ...data, pages: [{ ...(first ?? { nextBefore: null }), messages: merged }, ...rest] };
}

export interface ThreadData {
  root: ChatMessage;
  replies: ChatMessage[];
  nextAfter: number | null;
}

/** Insert or replace a reply in a cached thread, in seq order. */
export function upsertReply(data: ThreadData | undefined, msg: ChatMessage): ThreadData | undefined {
  if (!data) return data;
  const i = data.replies.findIndex(
    (m) => m.id === msg.id || (!!msg.clientId && m.clientId === msg.clientId && (m.pending || m.failed)),
  );
  const replies = i === -1 ? [...data.replies, msg] : data.replies.map((m, j) => (j === i ? msg : m));
  replies.sort((a, b) => (a.pending ? Infinity : a.seq) - (b.pending ? Infinity : b.seq));
  return { ...data, replies };
}

/** One thread. The live stream keeps it current while it is open. */
export function useThread(rootId: string | null) {
  return useQuery({
    queryKey: chatKeys.thread(rootId ?? 'none'),
    queryFn: () => apiClient.get<ThreadData>(`/chat/messages/${rootId}/thread`),
    enabled: !!rootId,
    staleTime: Infinity,
  });
}

export interface SendVars {
  text: string;
  clientId: string;
  mentions?: string[];
  mentionTeams?: string[];
  orderIds?: string[];
  files?: File[];
  /** Reply in this thread. */
  threadRoot?: string;
  /** Quote this message (same conversation only — the API refuses others). */
  quoteId?: string;
}

/**
 * Send a message. With attachments it must go as multipart, which apiClient
 * cannot do (it JSON-serializes), so those use the shared raw-fetch helper —
 * same cookies, same CSRF header, same endpoint.
 */
export function useSendMessage(channelId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: SendVars): Promise<{ message: ChatMessage; thread?: ChatMessage | null }> => {
      const url = `/chat/channels/${channelId}/messages`;
      if (!vars.files?.length) {
        const { files: _files, ...json } = vars;
        return apiClient.post<{ message: ChatMessage; thread?: ChatMessage | null }>(url, json);
      }
      const form = new FormData();
      form.append('text', vars.text);
      form.append('clientId', vars.clientId);
      if (vars.mentions?.length) form.append('mentions', JSON.stringify(vars.mentions));
      if (vars.mentionTeams?.length) form.append('mentionTeams', JSON.stringify(vars.mentionTeams));
      if (vars.orderIds?.length) form.append('orderIds', JSON.stringify(vars.orderIds));
      if (vars.threadRoot) form.append('threadRoot', vars.threadRoot);
      if (vars.quoteId) form.append('quoteId', vars.quoteId);
      for (const file of vars.files) form.append('files', file);

      const res = await submitMultipart(`/api/v1${url}`, 'POST', form);
      const body = await parseApiResponse(res);
      if (!res.ok) throw new Error((body as { message?: string }).message || 'Could not send that message');
      return body as unknown as { message: ChatMessage; thread?: ChatMessage | null };
    },
    onSuccess: (res) => {
      if (!channelId) return;
      if (res.message.threadRoot) {
        qc.setQueryData<ThreadData>(chatKeys.thread(res.message.threadRoot), (d) => upsertReply(d, res.message));
        if (res.thread) qc.setQueryData<Pages>(chatKeys.messages(channelId), (d) => applyThreadUpdate(d, res.thread!));
      } else {
        qc.setQueryData<Pages>(chatKeys.messages(channelId), (d) => upsertMessage(d, res.message));
      }
      // A shared file belongs in the Files tab straight away.
      if (res.message.attachments.length) qc.invalidateQueries({ queryKey: chatKeys.files(channelId) });
    },
  });
}

/**
 * Put a changed message (and, when it was a thread's newest reply, its thread
 * root) back into every cache that holds it — IN PLACE.
 *
 * Not applyThreadUpdate: that moves a thread to the bottom of the conversation,
 * which is right when someone replies and wrong when someone fixes a typo. The
 * server leaves the thread's position alone on an edit or delete, and so does this.
 */
export function applyMessageChange(
  qc: ReturnType<typeof useQueryClient>,
  channelId: string,
  msg: ChatMessage,
  thread?: ChatMessage | null,
) {
  const replace = (list: ChatMessage[], m: ChatMessage) => list.map((x) => (x.id === m.id ? m : x));
  const inPages = (m: ChatMessage) =>
    qc.setQueryData<Pages>(chatKeys.messages(channelId), (d) =>
      d ? { ...d, pages: d.pages.map((p) => ({ ...p, messages: replace(p.messages, m) })) } : d,
    );
  // A message is cached as a thread's root (when that thread is open) or as a reply in one.
  const inThreads = (m: ChatMessage) =>
    qc.setQueriesData<ThreadData>({ queryKey: [...chatKeys.all, 'thread'] }, (d) =>
      d ? { ...d, root: d.root.id === m.id ? m : d.root, replies: replace(d.replies, m) } : d,
    );

  if (!msg.threadRoot) inPages(msg);
  inThreads(msg);
  if (thread) {
    inPages(thread);
    inThreads(thread);
  }
}

/** Edit your own message's text, within the window the server allows. */
export function useEditMessage(channelId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiClient.patch<{ message: ChatMessage; thread?: ChatMessage | null }>(`/chat/messages/${id}`, { text }),
    onSuccess: (res) => {
      if (channelId) applyMessageChange(qc, channelId, res.message, res.thread);
    },
  });
}

/**
 * Delete your own message, within the window the server allows.
 *
 * Refetches rather than patching the cache: what a deleted message looks like
 * depends on who is reading (an admin still sees its words, nobody else does),
 * and only the server knows that. A delete is rare enough that a refetch costs
 * nothing anyone will notice.
 */
export function useDeleteMessage(channelId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ deleted: boolean; messageId: string; thread?: ChatMessage | null }>(`/chat/messages/${id}`),
    onSuccess: () => {
      if (!channelId) return;
      qc.invalidateQueries({ queryKey: chatKeys.messages(channelId) });
      qc.invalidateQueries({ queryKey: [...chatKeys.all, 'thread'] });
      qc.invalidateQueries({ queryKey: chatKeys.files(channelId) });
    },
  });
}

// ── reactions ────────────────────────────────────────────────────────────────

/**
 * `reactions` with `userId`'s `emoji` put on (`on`) or taken off — the same
 * rule the server applies, so the tap shows at once and the server's answer
 * normally changes nothing. Pure, for the optimistic update and its tests.
 */
export function withReaction(reactions: ChatReaction[] = [], emoji: string, userId: string, on: boolean): ChatReaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (on) {
    if (existing?.userIds.includes(userId)) return reactions;
    if (!existing) return [...reactions, { emoji, count: 1, userIds: [userId] }];
    return reactions.map((r) => (r === existing ? { ...r, count: r.count + 1, userIds: [...r.userIds, userId] } : r));
  }
  if (!existing?.userIds.includes(userId)) return reactions;
  return reactions
    .map((r) => (r === existing ? { ...r, count: r.count - 1, userIds: r.userIds.filter((id) => id !== userId) } : r))
    .filter((r) => r.count > 0);
}

/** Put a message's reactions into every cache that holds it (timeline and threads). */
export function applyReactions(
  qc: ReturnType<typeof useQueryClient>,
  channelId: string,
  messageId: string,
  reactions: ChatReaction[],
) {
  const set = (m: ChatMessage) => (m.id === messageId ? { ...m, reactions } : m);
  qc.setQueryData<Pages>(chatKeys.messages(channelId), (d) =>
    d ? { ...d, pages: d.pages.map((p) => ({ ...p, messages: p.messages.map(set) })) } : d,
  );
  qc.setQueriesData<ThreadData>({ queryKey: [...chatKeys.all, 'thread'] }, (d) =>
    d ? { ...d, root: set(d.root), replies: d.replies.map(set) } : d,
  );
}

/**
 * Put your emoji on a message, or take it off. Shown at once (a reaction is
 * cheap and undoable, unlike anything to do with money), then replaced by what
 * the server stored. On failure the caches are refetched rather than rolled
 * back by hand: someone else's reaction may have arrived in the meantime.
 */
export function useReactToMessage(channelId: string | null, meId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, emoji, on }: { message: ChatMessage; emoji: string; on: boolean }) =>
      apiClient.post<{ messageId: string; reactions: ChatReaction[] }>(`/chat/messages/${message.id}/reactions`, { emoji, on }),
    onMutate: ({ message, emoji, on }) => {
      if (channelId) applyReactions(qc, channelId, message.id, withReaction(message.reactions, emoji, meId, on));
    },
    onSuccess: (res) => {
      if (channelId) applyReactions(qc, channelId, res.messageId, res.reactions);
    },
    onError: () => {
      if (!channelId) return;
      qc.invalidateQueries({ queryKey: chatKeys.messages(channelId) });
      qc.invalidateQueries({ queryKey: [...chatKeys.all, 'thread'] });
    },
  });
}

/** Everything shared in one channel, newest first. */
export function useChannelFiles(channelId: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: chatKeys.files(channelId ?? 'none'),
    queryFn: async ({ pageParam }) => {
      const q = new URLSearchParams({ limit: '30' });
      if (pageParam) q.set('before', String(pageParam));
      return apiClient.get<{ files: ChatFile[]; nextBefore: string | null }>(
        `/chat/channels/${channelId}/files?${q}`,
      );
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: !!channelId && enabled,
    staleTime: 30_000,
  });
}

/** Recent paid orders, for attaching one to a message. */
export function useRecentOrders(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.recentOrders(),
    queryFn: async () => (await apiClient.get<{ orders: RecentOrder[] }>('/chat/orders/recent')).orders ?? [],
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Mark one tab of a channel read up to `seq`. Chat and Order updates are read
 * separately. A tab is read up to its newest message, so its badge clears at
 * once; the next channel poll brings the server's exact counts.
 */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, seq, part }: { channelId: string; seq: number; part: ReadPart }) =>
      apiClient.post(`/chat/channels/${channelId}/read`, { seq, part }),
    onMutate: ({ channelId, seq, part }) => {
      qc.setQueryData<ChatChannel[]>(chatKeys.channels(), (list) =>
        list?.map((c) => {
          if (c.id !== channelId) return c;
          const next = part === 'updates'
            ? { ...c, lastReadUpdatesSeq: Math.max(seq, readUpdatesSeqOf(c)), unreadUpdates: 0 }
            : { ...c, lastReadSeq: Math.max(seq, c.lastReadSeq), unreadChat: 0 };
          const unread = unreadChatOf(next) + unreadUpdatesOf(next);
          // The mention count is per channel, not per tab: exact on the next poll.
          return { ...next, unread, unreadMentions: unread === 0 ? 0 : Math.min(c.unreadMentions ?? 0, unread) };
        }),
      );
    },
  });
}

/**
 * "Mark as unread" from a message, for me. Not optimistic about the counts
 * (the server knows what lies past that message); the read position it sends
 * back goes into the cache at once, and the channel list refetches the numbers.
 */
export function useMarkUnread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiClient.post<{ channelId: string; part: ReadPart; lastReadSeq: number; lastReadUpdatesSeq: number }>(
        `/chat/messages/${messageId}/unread`,
        {},
      ),
    onSuccess: (res) => {
      qc.setQueryData<ChatChannel[]>(chatKeys.channels(), (list) =>
        list?.map((c) => (c.id === res.channelId
          ? { ...c, lastReadSeq: res.lastReadSeq, lastReadUpdatesSeq: res.lastReadUpdatesSeq }
          : c)),
      );
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}

/** Set my notification setting for one conversation. Shown at once; the server's answer confirms it. */
export function useSetNotify() {
  const qc = useQueryClient();
  const put = (channelId: string, notify: NotifyLevel) =>
    qc.setQueryData<ChatChannel[]>(chatKeys.channels(), (list) => list?.map((c) => (c.id === channelId ? { ...c, notify } : c)));
  return useMutation({
    mutationFn: ({ channelId, notify }: { channelId: string; notify: NotifyLevel }) =>
      apiClient.put<{ channelId: string; notify: NotifyLevel }>(`/chat/channels/${channelId}/notify`, { notify }),
    onMutate: ({ channelId, notify }) => put(channelId, notify),
    // The mention count only exists for "@mentions only" — fetch the real numbers.
    onSettled: () => qc.invalidateQueries({ queryKey: chatKeys.channels() }),
  });
}

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string; memberIds?: string[] }) =>
      apiClient.post<{ channel: { id: string } }>('/chat/channels', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.channels() }),
  });
}

export function useOpenDm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiClient.post<{ channel: { id: string } }>('/chat/dm', { userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.channels() }),
  });
}

// ── search ───────────────────────────────────────────────────────────────────
/** A search hit: a message plus the channel it was found in. */
export interface ChatSearchHit extends ChatMessage {
  channel: string;
  channelName: string;
  channelKind: 'space' | 'dm';
}

interface SearchPage {
  messages: ChatSearchHit[];
  nextBefore: string | null;
}

/**
 * Search message text across every channel the signed-in person may see.
 *
 * `enabled` on a two-character minimum rather than debouncing in the caller:
 * a one-letter query matches most of the history, and the server refuses it
 * anyway, so the request is simply not worth making. Pages are keyset on
 * createdAt — chat history only grows, and `skip` over it both slows down and
 * duplicates rows when someone posts mid-scroll.
 */
export function useChatSearch(term: string, channelId?: string | null) {
  const q = term.trim();
  return useInfiniteQuery({
    queryKey: chatKeys.search(q, channelId),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ q, limit: '25' });
      if (channelId) params.set('channelId', channelId);
      if (pageParam) params.set('before', String(pageParam));
      const res = await apiClient.get<SearchPage>(`/chat/search?${params}`);
      return { messages: res.messages ?? [], nextBefore: res.nextBefore ?? null };
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}
