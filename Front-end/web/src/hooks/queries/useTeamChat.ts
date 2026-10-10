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
  audience: 'all' | 'team' | 'members';
  team: string | null;
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
  createdAt: string;
  /** Client-only: still being sent / failed to send. */
  pending?: boolean;
  failed?: boolean;
}

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
  const [first, ...rest] = pages;
  const merged = [...(first?.messages ?? []), msg].sort(
    (a, b) => (a.pending ? Infinity : a.seq) - (b.pending ? Infinity : b.seq),
  );
  return { ...data, pages: [{ ...(first ?? { nextBefore: null }), messages: merged }, ...rest] };
}

export interface SendVars {
  text: string;
  clientId: string;
  mentions?: string[];
  mentionTeams?: string[];
  orderIds?: string[];
  files?: File[];
}

/**
 * Send a message. With attachments it must go as multipart, which apiClient
 * cannot do (it JSON-serializes), so those use the shared raw-fetch helper —
 * same cookies, same CSRF header, same endpoint.
 */
export function useSendMessage(channelId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: SendVars): Promise<{ message: ChatMessage }> => {
      const url = `/chat/channels/${channelId}/messages`;
      if (!vars.files?.length) {
        const { files: _files, ...json } = vars;
        return apiClient.post<{ message: ChatMessage }>(url, json);
      }
      const form = new FormData();
      form.append('text', vars.text);
      form.append('clientId', vars.clientId);
      if (vars.mentions?.length) form.append('mentions', JSON.stringify(vars.mentions));
      if (vars.mentionTeams?.length) form.append('mentionTeams', JSON.stringify(vars.mentionTeams));
      if (vars.orderIds?.length) form.append('orderIds', JSON.stringify(vars.orderIds));
      for (const file of vars.files) form.append('files', file);

      const res = await submitMultipart(`/api/v1${url}`, 'POST', form);
      const body = await parseApiResponse(res);
      if (!res.ok) throw new Error((body as { message?: string }).message || 'Could not send that message');
      return body as unknown as { message: ChatMessage };
    },
    onSuccess: (res) => {
      if (!channelId) return;
      qc.setQueryData<Pages>(chatKeys.messages(channelId), (d) => upsertMessage(d, res.message));
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

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (msg: ChatMessage) => apiClient.delete(`/chat/messages/${msg.id}`),
    onSuccess: (_r, msg) => {
      qc.setQueryData<Pages>(chatKeys.messages(msg.channelId), (d) =>
        upsertMessage(d, { ...msg, deleted: true, text: '' }),
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
