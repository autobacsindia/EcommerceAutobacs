'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { submitMultipart, parseApiResponse } from '@/lib/multipartResponse';
import { useAuth } from '@/context/AuthContext';
import { chatKeys } from './keys';

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
  lastMessageSeq: number;
  lastMessageAt: string | null;
  lastReadSeq: number;
  unread: number;
}

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
}

export interface ChatQuote {
  id: string;
  seq: number;
  by: string;
  preview: string;
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
    refetchInterval: options.poll ? 30_000 : false,
  });
}

/** Total unread across every channel — for the "Chat" nav badge. */
export function useChatUnreadTotal(): number {
  const { data } = useChatChannels({ poll: true });
  return (data ?? []).reduce((n, c) => n + c.unread, 0);
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

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, seq }: { channelId: string; seq: number }) =>
      apiClient.post(`/chat/channels/${channelId}/read`, { seq }),
    onMutate: ({ channelId, seq }) => {
      qc.setQueryData<ChatChannel[]>(chatKeys.channels(), (list) =>
        list?.map((c) => (c.id === channelId ? { ...c, lastReadSeq: seq, unread: Math.max(0, c.lastMessageSeq - seq) } : c)),
      );
    },
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
