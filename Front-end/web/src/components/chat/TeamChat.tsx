'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { ArrowLeft, Hash, Lock, MessageSquarePlus, Plus, RotateCcw, Send, Trash2, Users, X } from 'lucide-react';
import { useSSE } from '@/hooks/useSSE';
import { useAuth } from '@/context/AuthContext';
import { chatKeys } from '@/hooks/queries/keys';
import {
  upsertMessage,
  useCanChat,
  useChatChannels,
  useChatMe,
  useChatMessages,
  useChatPeople,
  useCreateSpace,
  useDeleteMessage,
  useMarkRead,
  useOpenDm,
  useSendMessage,
} from '@/hooks/queries/useTeamChat';
import type { ChatChannel, ChatMessage, ChatPerson, MessagePage } from '@/hooks/queries/useTeamChat';

type Pages = InfiniteData<MessagePage, number>;

const GREEN = '#0a5c33';

// ── small helpers ────────────────────────────────────────────────────────────

const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Plain text with http(s) links made clickable. Never renders HTML from a message. */
function MessageText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-800">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[#0b6b9a] underline break-all">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

function Avatar({ person, system }: { person: ChatPerson | null; system?: boolean }) {
  if (system) {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: GREEN }} aria-hidden="true">
        R
      </span>
    );
  }
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-sm font-bold text-emerald-900" aria-hidden="true">
      {initials(person?.name ?? '?')}
    </span>
  );
}

function ChannelIcon({ channel }: { channel: ChatChannel }) {
  if (channel.kind === 'dm') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-emerald-100 text-[10px] font-bold text-emerald-900" aria-hidden="true">
        {initials(channel.name)}
      </span>
    );
  }
  const Icon = channel.audience === 'members' ? Lock : Hash;
  return <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />;
}

// ── dialogs ──────────────────────────────────────────────────────────────────

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PeoplePicker({
  people,
  selected,
  onToggle,
  single,
}: {
  people: ChatPerson[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  single?: boolean;
}) {
  const [q, setQ] = useState('');
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people"
        aria-label="Search people"
        className="mb-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-emerald-600"
      />
      <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
        {shown.length === 0 && <li className="p-3 text-sm text-gray-500">No one found</li>}
        {shown.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onToggle(p.id)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 ${selected.has(p.id) ? 'bg-emerald-50' : ''}`}
              aria-pressed={selected.has(p.id)}
            >
              <Avatar person={p} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{p.name}</span>
                <span className="block text-xs text-gray-500">{p.teamLabel}{p.isHead ? ' · Head' : ''}</span>
              </span>
              {!single && selected.has(p.id) && <span className="text-xs font-semibold text-emerald-700">Added</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewMessageDialog({ meId, onClose, onOpened }: { meId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const { data: people = [] } = useChatPeople();
  const openDm = useOpenDm();
  const others = people.filter((p) => p.id !== meId);
  return (
    <Dialog title="New message" onClose={onClose}>
      <PeoplePicker
        people={others}
        selected={new Set()}
        single
        onToggle={async (id) => {
          const res = await openDm.mutateAsync(id);
          onOpened(res.channel.id);
        }}
      />
      {openDm.isError && <p className="mt-2 text-sm text-red-600">Couldn&apos;t open the chat. Please try again.</p>}
    </Dialog>
  );
}

function NewSpaceDialog({ meId, onClose, onCreated }: { meId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { data: people = [] } = useChatPeople();
  const create = useCreateSpace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await create.mutateAsync({ name, description, memberIds: [...members] });
      onCreated(res.channel.id);
    } catch (err) {
      setError((err as { message?: string })?.message || 'Could not create the space');
    }
  };

  return (
    <Dialog title="New space" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={60}
            placeholder="e.g. diwali-sale"
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-emerald-600"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">What is it for? (optional)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={240}
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-emerald-600"
          />
        </label>
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Members</span>
          <PeoplePicker
            people={people.filter((p) => p.id !== meId)}
            selected={members}
            onToggle={(id) =>
              setMembers((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
          <p className="mt-1 text-xs text-gray-500">Admins can always see every space.</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={create.isPending || name.trim().length < 2}
          className="h-11 w-full rounded-full text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: GREEN }}
        >
          {create.isPending ? 'Creating…' : 'Create space'}
        </button>
      </form>
    </Dialog>
  );
}

// ── conversation ─────────────────────────────────────────────────────────────

function Conversation({
  channel,
  meId,
  isAdmin,
  onBack,
}: {
  channel: ChatChannel;
  meId: string;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } = useChatMessages(channel.id);
  const send = useSendMessage(channel.id);
  const markRead = useMarkRead();
  const del = useDeleteMessage();
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);

  // Oldest → newest across pages (pages[0] is the newest page).
  const messages = useMemo(
    () => (data?.pages ?? []).slice().reverse().flatMap((p) => p.messages),
    [data],
  );
  const lastSeq = messages.reduce((n, m) => (!m.pending && m.seq > n ? m.seq : n), 0);

  // Keep pinned to the bottom for new messages; keep position when older ones load above.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFrom.current != null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // New channel → start at the bottom.
  useEffect(() => {
    stickToBottom.current = true;
  }, [channel.id]);

  // Mark read when the newest message is on screen and the tab is visible.
  useEffect(() => {
    if (!lastSeq || lastSeq <= channel.lastReadSeq) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!stickToBottom.current) return;
    // Immediately, not debounced: switching channels right after a message arrives
    // must not leave it counted as unread. onMutate bumps lastReadSeq in the cache,
    // so this does not re-fire for the same message.
    markRead.mutate({ channelId: channel.id, seq: lastSeq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSeq, channel.id, channel.lastReadSeq]);

  // Coming back to the tab counts as reading what arrived while it was hidden.
  const latest = useRef({ lastSeq, lastReadSeq: channel.lastReadSeq });
  latest.current = { lastSeq, lastReadSeq: channel.lastReadSeq };
  useEffect(() => {
    const onVisible = () => {
      const { lastSeq: seq, lastReadSeq } = latest.current;
      if (document.visibilityState === 'visible' && stickToBottom.current && seq > lastReadSeq) {
        markRead.mutate({ channelId: channel.id, seq });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && hasNextPage && !isFetchingNextPage) {
      restoreFrom.current = el.scrollHeight - el.scrollTop;
      fetchNextPage();
    }
    if (stickToBottom.current && lastSeq > channel.lastReadSeq) {
      markRead.mutate({ channelId: channel.id, seq: lastSeq });
    }
  };

  const doSend = (body: string, clientId = newClientId()) => {
    const optimistic: ChatMessage = {
      id: `pending-${clientId}`,
      channelId: channel.id,
      seq: Number.MAX_SAFE_INTEGER,
      kind: 'user',
      text: body,
      deleted: false,
      sender: { id: meId, name: 'You', role: isAdmin ? 'admin' : 'staff', team: null, teamLabel: null, isHead: false },
      clientId,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    stickToBottom.current = true;
    qc.setQueryData<Pages>(chatKeys.messages(channel.id), (d) => upsertMessage(d, optimistic));
    send.mutate(
      { text: body, clientId },
      {
        onError: () =>
          qc.setQueryData<Pages>(chatKeys.messages(channel.id), (d) =>
            upsertMessage(d, { ...optimistic, pending: false, failed: true }),
          ),
      },
    );
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    doSend(body);
  };

  const title = channel.kind === 'dm' ? channel.name : `#${channel.name}`;
  const subtitle =
    channel.kind === 'dm'
      ? [channel.partner?.teamLabel, channel.partner?.isHead ? 'Head' : null].filter(Boolean).join(' · ')
      : channel.description;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-white" aria-label={`Conversation ${title}`}>
      <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 md:hidden" aria-label="Back to channels">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
        </div>
        {channel.audience === 'members' && channel.kind === 'space' && channel.memberCount != null && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500">
            <Users className="h-4 w-4" /> {channel.memberCount}
          </span>
        )}
      </header>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {isFetchingNextPage && <p className="py-2 text-center text-xs text-gray-500">Loading older messages…</p>}
        {!hasNextPage && !isLoading && messages.length > 0 && (
          <p className="py-3 text-center text-xs text-gray-400">This is the beginning of {title}</p>
        )}
        {isLoading && <p className="py-10 text-center text-sm text-gray-500">Loading messages…</p>}
        {isError && (
          <div className="py-10 text-center text-sm text-gray-600">
            Couldn&apos;t load messages.{' '}
            <button type="button" className="font-semibold text-emerald-700 underline" onClick={() => refetch()}>
              Try again
            </button>
          </div>
        )}
        {!isLoading && !isError && messages.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-base font-semibold text-gray-800">No messages yet</p>
            <p className="text-sm text-gray-500">Say hello to get the conversation going.</p>
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped =
            !newDay && prev && prev.kind === m.kind && prev.sender?.id === m.sender?.id &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          const mine = m.sender?.id === meId;
          const canDelete = !m.deleted && !m.pending && !m.failed && m.kind === 'user' && (mine || isAdmin);
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 flex items-center gap-3 text-xs font-medium text-gray-500">
                  <span className="h-px flex-1 bg-gray-200" />
                  {dayLabel(m.createdAt)}
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
              )}
              <div className={`group relative flex gap-3 rounded-lg px-2 ${grouped ? 'py-0.5' : 'mt-2 py-1'} hover:bg-gray-50`}>
                {grouped ? <span className="w-9 shrink-0" /> : <Avatar person={m.sender} system={m.kind === 'system'} />}
                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {m.kind === 'system' ? 'Roavion updates' : mine ? 'You' : m.sender?.name ?? 'Former member'}
                      </span>
                      {m.kind !== 'system' && m.sender?.teamLabel && (
                        <span className="text-xs text-gray-500">{m.sender.teamLabel}</span>
                      )}
                      <span className="text-xs text-gray-400">{timeOf(m.createdAt)}</span>
                    </div>
                  )}
                  {m.deleted ? (
                    <p className="text-sm italic text-gray-400">This message was deleted</p>
                  ) : (
                    <div className={m.pending ? 'opacity-60' : ''}>
                      <MessageText text={m.text} />
                    </div>
                  )}
                  {m.failed && (
                    <p className="mt-1 flex items-center gap-2 text-xs text-red-600">
                      Not sent.
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-semibold underline"
                        onClick={() => doSend(m.text, m.clientId ?? undefined)}
                      >
                        <RotateCcw className="h-3 w-3" /> Retry
                      </button>
                    </p>
                  )}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Delete this message?')) del.mutate(m);
                    }}
                    className="absolute right-2 top-1 hidden rounded-md bg-white p-1 text-gray-400 shadow-sm hover:text-red-600 group-hover:block focus:block"
                    aria-label="Delete message"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="border-t border-gray-200 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-gray-300 bg-white p-2 focus-within:border-emerald-600">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={`Message ${title}`}
            aria-label={`Message ${title}`}
            className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[15px] text-gray-900 outline-none"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white disabled:opacity-40"
            style={{ background: GREEN }}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 hidden text-[11px] text-gray-400 sm:block">Enter to send · Shift + Enter for a new line</p>
      </form>
    </section>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

/**
 * Internal team chat (admins + staff). Spaces and DMs on the left, the open
 * conversation on the right; on phones one at a time. Live via SSE; every read
 * and write is permission-checked by the API.
 */
export default function TeamChat() {
  const canChat = useCanChat();
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: channels = [], isLoading, isError, refetch } = useChatChannels();
  const { data: me } = useChatMe();
  const [dialog, setDialog] = useState<'space' | 'dm' | null>(null);

  const meId = me?.userId ?? '';
  const isAdmin = user?.role === 'admin';

  const selectedId = params.get('c');
  const selected = channels.find((c) => c.id === selectedId) ?? null;

  const select = useCallback(
    (id: string | null) => {
      const q = new URLSearchParams(params.toString());
      if (id) q.set('c', id);
      else q.delete('c');
      router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Desktop: open #company by default so the page is never empty.
  useEffect(() => {
    if (!selectedId && channels.length && typeof window !== 'undefined' && window.innerWidth >= 768) {
      select(channels[0].id);
    }
  }, [selectedId, channels, select]);

  // Live updates.
  const refreshChannels = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleChannelsRefresh = () => {
    if (refreshChannels.current) clearTimeout(refreshChannels.current);
    refreshChannels.current = setTimeout(() => qc.invalidateQueries({ queryKey: chatKeys.channels() }), 250);
  };

  useSSE({
    url: '/api/v1/chat/stream',
    token: null,
    enabled: canChat,
    onMessage: (event) => {
      const e = event as unknown as { type: string; channelId?: string; message?: ChatMessage; messageId?: string };
      if (e.type === 'message' && e.message && e.channelId) {
        qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) => upsertMessage(d, e.message!));
        scheduleChannelsRefresh();
      } else if (e.type === 'message_deleted' && e.channelId && e.messageId) {
        qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) =>
          d
            ? {
                ...d,
                pages: d.pages.map((p) => ({
                  ...p,
                  messages: p.messages.map((m) => (m.id === e.messageId ? { ...m, deleted: true, text: '' } : m)),
                })),
              }
            : d,
        );
      } else if (e.type === 'channel') {
        scheduleChannelsRefresh();
      }
    },
    // After a drop, catch up on anything missed while disconnected.
    onConnect: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
      if (selectedId) qc.invalidateQueries({ queryKey: chatKeys.messages(selectedId) });
    },
  });

  if (!canChat) {
    return <p className="p-6 text-gray-600">Team chat is available to staff and admins only.</p>;
  }

  const spaces = channels.filter((c) => c.kind === 'space');
  const dms = channels.filter((c) => c.kind === 'dm');

  const row = (c: ChatChannel) => {
    const active = c.id === selectedId;
    return (
      <li key={c.id}>
        <button
          type="button"
          onClick={() => select(c.id)}
          aria-current={active ? 'true' : undefined}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[15px] ${
            active ? 'bg-emerald-100 text-emerald-950' : 'text-gray-700 hover:bg-gray-100'
          } ${c.unread > 0 ? 'font-semibold text-gray-900' : ''}`}
        >
          <ChannelIcon channel={c} />
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          {c.unread > 0 && (
            <span className="min-w-[22px] rounded-full px-1.5 text-center text-xs font-bold leading-[20px] text-white" style={{ background: GREEN }}>
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="flex h-[calc(100dvh-140px)] min-h-[480px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <aside
        className={`w-full shrink-0 flex-col border-r border-gray-200 bg-gray-50 md:flex md:w-72 ${selected ? 'hidden' : 'flex'}`}
        aria-label="Chat channels"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h1 className="text-lg font-bold text-gray-900">Team chat</h1>
          <button
            type="button"
            onClick={() => setDialog('dm')}
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-200"
            aria-label="New message"
            title="New message"
          >
            <MessageSquarePlus className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {isLoading && <p className="px-3 py-4 text-sm text-gray-500">Loading…</p>}
          {isError && (
            <p className="px-3 py-4 text-sm text-gray-600">
              Couldn&apos;t load chat.{' '}
              <button type="button" className="font-semibold text-emerald-700 underline" onClick={() => refetch()}>
                Retry
              </button>
            </p>
          )}
          <div className="mt-2 flex items-center justify-between px-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Spaces
            {me?.canCreateSpace && (
              <button type="button" onClick={() => setDialog('space')} className="rounded p-1 hover:bg-gray-200" aria-label="New space" title="New space">
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          <ul className="mt-1 space-y-0.5">{spaces.map(row)}</ul>
          <div className="mt-4 flex items-center justify-between px-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Direct messages
            <button type="button" onClick={() => setDialog('dm')} className="rounded p-1 hover:bg-gray-200" aria-label="Start a direct message" title="Start a direct message">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <ul className="mt-1 space-y-0.5">
            {dms.length === 0 && <li className="px-3 py-1 text-sm text-gray-400">No direct messages yet</li>}
            {dms.map(row)}
          </ul>
        </div>
      </aside>

      {selected ? (
        <Conversation key={selected.id} channel={selected} meId={meId} isAdmin={isAdmin} onBack={() => select(null)} />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-gray-500 md:flex">Pick a space or person to start chatting</div>
      )}

      {dialog === 'dm' && (
        <NewMessageDialog meId={meId} onClose={() => setDialog(null)} onOpened={(id) => { setDialog(null); select(id); }} />
      )}
      {dialog === 'space' && (
        <NewSpaceDialog meId={meId} onClose={() => setDialog(null)} onCreated={(id) => { setDialog(null); select(id); }} />
      )}
    </div>
  );
}
