'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { ChevronDown, Keyboard, MessageSquarePlus, Plus, Search, Star } from 'lucide-react';
import { useSSE } from '@/hooks/useSSE';
import { useAuth } from '@/context/AuthContext';
import { chatKeys } from '@/hooks/queries/keys';
import {
  upsertMessage,
  upsertReply,
  applyThreadUpdate,
  applyMessageChange,
  applyReactions,
  applyPinned,
  applyPreview,
  countedUnread,
  notifyOf,
  useCanChat,
  useChatChannels,
  useChatMe,
  useChatPeople,
  usePresence,
  liveStatus,
  useCreateSpace,
  useOpenDm,
} from '@/hooks/queries/useTeamChat';
import type { ChatChannel, ChatMessage, ChatPerson, ChatReaction, MessagePage, ThreadData } from '@/hooks/queries/useTeamChat';
import { Avatar, ChannelIcon, Dialog, GREEN, OnlineDot, shortWhen } from './chatUi';
import QuickSwitcher, { channelTitle } from './QuickSwitcher';
import { Kbd, ShortcutsDialog, modKeyLabel, useHotkeys, type ShortcutGroup } from '@/components/panel/shortcuts';
import Conversation from './Conversation';
import { NotifyIcon } from './NotifyMenu';
import MessageSearch from './MessageSearch';
import StarredPanel from './StarredPanel';
import StatusDialog from './StatusDialog';
import { ONE_PANE_BELOW, useFitToViewport } from './useFitToViewport';
import { setOpenConversation } from '@/lib/chatSound';

type Pages = InfiniteData<MessagePage, number>;

// ── dialogs ──────────────────────────────────────────────────────────────────

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
  const online = usePresence();
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
              aria-pressed={selected.has(p.id)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 ${selected.has(p.id) ? 'bg-emerald-50' : ''}`}
            >
              <Avatar person={p} online={online.has(p.id)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{p.name}</span>
                <span className="block truncate text-xs text-gray-500">
                  {p.teamLabel}{p.isHead ? ' · Head' : ''}{liveStatus(p.status) ? ` · ${liveStatus(p.status)!.text}` : ''}
                </span>
              </span>
              {!single && selected.has(p.id) && <span className="text-xs font-semibold text-emerald-700">Added</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Up to 7 others: one is a direct message, more is a group conversation. */
const MAX_GROUP_OTHERS = 7;

export function NewMessageDialog({ meId, onClose, onOpened }: { meId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const { data: people = [] } = useChatPeople();
  const openDm = useOpenDm();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_GROUP_OTHERS ? prev : [...prev, id]));
  const start = async () => {
    if (!picked.length || openDm.isPending) return;
    const res = await openDm.mutateAsync(picked);
    onOpened(res.channel.id);
  };
  const names = picked.map((id) => people.find((p) => p.id === id)?.name).filter(Boolean);
  return (
    <Dialog title="New chat" onClose={onClose}>
      <p className="mb-2 text-sm text-gray-600">
        Pick one person for a direct message, or up to {MAX_GROUP_OTHERS} for a group conversation. Only the people you pick can see it.
      </p>
      <PeoplePicker people={people.filter((p) => p.id !== meId)} selected={new Set(picked)} onToggle={toggle} />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-gray-600">
          {names.length ? names.join(', ') : 'No one picked yet'}
        </span>
        <button
          type="button"
          onClick={() => void start().catch(() => {})}
          disabled={!picked.length || openDm.isPending}
          className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {openDm.isPending ? 'Opening…' : picked.length > 1 ? `Start group (${picked.length + 1})` : 'Start chat'}
        </button>
      </div>
      {picked.length >= MAX_GROUP_OTHERS && <p className="mt-1 text-xs text-gray-500">That’s the most a group conversation can have.</p>}
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
          className="h-11 w-full rounded-full text-sm font-semibold text-[#fff] disabled:opacity-50"
          style={{ background: GREEN }}
        >
          {create.isPending ? 'Creating…' : 'Create space'}
        </button>
      </form>
    </Dialog>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

/**
 * Internal team chat (admins + active staff). Spaces and direct messages on the
 * left, the open conversation on the right; one at a time on phones. Messages
 * arrive over SSE, and every read and write is permission-checked by the API —
 * this component only hides what the server would refuse anyway.
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
  const { data: people = [] } = useChatPeople();
  const online = usePresence(canChat);
  const [editingStatus, setEditingStatus] = useState(false);
  const [dialog, setDialog] = useState<'space' | 'dm' | null>(null);
  // The list: everything, or only conversations with something unread.
  const [show, setShow] = useState<'all' | 'unread'>('all');
  const [switcher, setSwitcher] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const openDm = useOpenDm();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // null = closed. 'all' = every channel I can see; otherwise one channel id.
  const [searching, setSearching] = useState<string | null>(null);
  const [showStarred, setShowStarred] = useState(false);

  const meId = me?.userId ?? '';
  const meName = user?.name ?? 'You';
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const myStatus = liveStatus(peopleById.get(meId)?.status);
  const isAdmin = user?.role === 'admin';
  // Admins manage orders in their own panel; staff see them in the team panel.
  const orderHref = useCallback(
    (id: string) => (isAdmin ? `/admin/orders?order=${id}` : '/team/orders'),
    [isAdmin],
  );

  const selectedId = params.get('c');
  const selected = channels.find((c) => c.id === selectedId) ?? null;
  // The bell stays quiet for the conversation on screen (lib/chatSound.ts).
  useEffect(() => {
    setOpenConversation(selected?.id ?? null);
    return () => setOpenConversation(null);
  }, [selected?.id]);
  // ?t=updates: opened from an order-update pop-up or the bell — start on Order updates.
  const initialTab = params.get('t') === 'updates' ? 'updates' as const : undefined;

  const select = useCallback(
    (id: string | null) => {
      const q = new URLSearchParams(params.toString());
      // Picking a conversation by hand opens the tab its unread calls for.
      q.delete('t');
      if (id) q.set('c', id);
      else q.delete('c');
      router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Side by side, never show an empty pane; one pane at a time (phones, tablets),
  // start on the list.
  useEffect(() => {
    if (!selectedId && channels.length && typeof window !== 'undefined' && window.innerWidth >= ONE_PANE_BELOW) {
      select(channels[0].id);
    }
  }, [selectedId, channels, select]);

  // Several events can land together (a message plus its channel bump), so the
  // channel-list refresh is debounced into one request.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleChannelsRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => qc.invalidateQueries({ queryKey: chatKeys.channels() }), 250);
  }, [qc]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  useSSE({
    url: '/api/v1/chat/stream',
    token: null,
    enabled: canChat,
    onMessage: (event) => {
      const e = event as unknown as {
        type: string; channelId?: string; message?: ChatMessage; messageId?: string; thread?: ChatMessage;
        reactions?: ChatReaction[];
        pinned?: ChatMessage['pinned'];
        preview?: ChatMessage['preview'];
      };
      if (e.type === 'message' && e.message && e.channelId) {
        if (e.message.threadRoot) {
          // A reply: into its thread if open, and its root moves to the bottom.
          qc.setQueryData<ThreadData>(chatKeys.thread(e.message.threadRoot), (d) => upsertReply(d, e.message!));
          if (e.thread) qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) => applyThreadUpdate(d, e.thread!));
        } else {
          qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) => upsertMessage(d, e.message!));
        }
        if (e.message.attachments?.length) qc.invalidateQueries({ queryKey: chatKeys.files(e.channelId) });
        scheduleChannelsRefresh();
      } else if (e.type === 'message_edited' && e.message && e.channelId) {
        /*
          The broadcast carries the PUBLIC version — current text, no history —
          because one payload goes to everyone in the channel. An admin is
          entitled to the earlier versions too, so an admin refetches instead
          of taking the broadcast copy (which would overwrite the history they
          already have).
        */
        if (isAdmin) {
          qc.invalidateQueries({ queryKey: chatKeys.messages(e.channelId) });
          qc.invalidateQueries({ queryKey: [...chatKeys.all, 'thread'] });
        } else {
          applyMessageChange(qc, e.channelId, e.message, e.thread);
        }
      } else if (e.type === 'message_deleted' && e.channelId && e.messageId && isAdmin) {
        // Admins see a deleted message's words; the broadcast carries only its id.
        qc.invalidateQueries({ queryKey: chatKeys.messages(e.channelId) });
        qc.invalidateQueries({ queryKey: [...chatKeys.all, 'thread'] });
        qc.invalidateQueries({ queryKey: chatKeys.files(e.channelId) });
        qc.invalidateQueries({ queryKey: chatKeys.pins(e.channelId) });
      } else if (e.type === 'message_deleted' && e.channelId && e.messageId) {
        // A deleted message drops off the Pinned list.
        qc.invalidateQueries({ queryKey: chatKeys.pins(e.channelId) });
        // If it was a thread's newest reply, the thread's "last reply" line changed too.
        if (e.thread) applyMessageChange(qc, e.channelId, e.thread);
        qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) =>
          d
            ? {
                ...d,
                pages: d.pages.map((p) => ({
                  ...p,
                  messages: p.messages.map((m) =>
                    m.id === e.messageId ? { ...m, deleted: true, text: '', attachments: [], refs: [], quote: null, editableUntil: null } : m,
                  ),
                })),
              }
            : d,
        );
        // The deleted message may be a reply, or the root, of any cached thread.
        qc.setQueriesData<ThreadData>({ queryKey: [...chatKeys.all, 'thread'] }, (d) => {
          if (!d) return d;
          const hide = (m: ChatMessage) =>
            m.id === e.messageId ? { ...m, deleted: true, text: '', attachments: [], refs: [], quote: null, editableUntil: null } : m;
          return { ...d, root: hide(d.root), replies: d.replies.map(hide) };
        });
        qc.invalidateQueries({ queryKey: chatKeys.files(e.channelId) });
      } else if (e.type === 'message_preview' && e.channelId && e.messageId) {
        applyPreview(qc, e.channelId, e.messageId, e.preview ?? null);
      } else if (e.type === 'status') {
        qc.invalidateQueries({ queryKey: chatKeys.people() });
      } else if (e.type === 'message_pinned' && e.channelId && e.messageId) {
        applyPinned(qc, e.channelId, e.messageId, e.pinned ?? null);
      } else if (e.type === 'message_reactions' && e.channelId && e.messageId && e.reactions) {
        applyReactions(qc, e.channelId, e.messageId, e.reactions);
      } else if (e.type === 'channel') {
        scheduleChannelsRefresh();
      }
    },
    // A dropped connection means missed events: re-sync on reconnect.
    onConnect: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
      if (selectedId) qc.invalidateQueries({ queryKey: chatKeys.messages(selectedId) });
      qc.invalidateQueries({ queryKey: [...chatKeys.all, 'thread'] });
    },
  });

  // Muted conversations do not add to "N new" (the same rule as the nav badge).
  const totalUnread = useMemo(
    () => channels.reduce((n, c) => { const u = countedUnread(c); return n + u.chat + u.updates; }, 0),
    [channels],
  );

  /** What a row's badge counts: on "@mentions only" the mentions, on "Off" nothing. */
  const loud = (c: ChatChannel) => { const u = countedUnread(c); return u.chat + u.updates; };

  const { spaces, betweenTeams, dms } = useMemo(() => {
    // "Unread" keeps the open conversation in the list, so it does not vanish
    // the moment it is read.
    const visible = channels.filter((c) => show === 'all' || c.unread > 0 || c.id === selectedId);
    return {
      spaces: visible.filter((c) => c.kind === 'space' && c.audience !== 'teams'),
      betweenTeams: visible
        .filter((c) => c.audience === 'teams')
        // Busiest first: the conversation that moved last is the one to look at.
        .sort((x, y) => new Date(y.lastMessageAt || 0).getTime() - new Date(x.lastMessageAt || 0).getTime()),
      dms: visible.filter((c) => c.kind === 'dm'),
    };
  }, [channels, show, selectedId]);

  const openPerson = useCallback(async (personId: string) => {
    setSwitcher(false);
    try {
      const res = await openDm.mutateAsync([personId]);
      select(res.channel.id);
    } catch { /* the mutation's own error state; the list is unchanged */ }
    // openDm is a stable mutation object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  // Alt+↑ / Alt+↓ walk the list in the order it is drawn (collapsed sections skipped).
  const step = useCallback((by: number) => {
    const order = [
      ...(collapsed.has('spaces') ? [] : spaces),
      ...(collapsed.has('teams') ? [] : betweenTeams),
      ...(collapsed.has('dms') ? [] : dms),
    ];
    if (!order.length) return;
    const at = order.findIndex((c) => c.id === selectedId);
    const next = order[at < 0 ? 0 : (at + by + order.length) % order.length];
    select(next.id);
  }, [spaces, betweenTeams, dms, collapsed, selectedId, select]);

  useHotkeys([
    { key: 'k', mod: true, run: (e) => { e.preventDefault(); setSwitcher(true); } },
    { key: '?', run: (e) => { e.preventDefault(); setShortcuts(true); } },
    { key: 'ArrowUp', alt: true, run: (e) => { e.preventDefault(); step(-1); } },
    { key: 'ArrowDown', alt: true, run: (e) => { e.preventDefault(); step(1); } },
  ], canChat);

  const box = useRef<HTMLDivElement>(null);
  useFitToViewport(box, canChat);

  if (!canChat) {
    return <p className="p-6 text-gray-600">Team chat is available to staff and admins only.</p>;
  }

  const row = (c: ChatChannel) => {
    const active = c.id === selectedId;
    const level = notifyOf(c);
    const counted = loud(c);
    const status = c.kind === 'dm' && !c.group && c.partner ? liveStatus(peopleById.get(c.partner.id)?.status) : null;
    return (
      <li key={c.id}>
        <button
          type="button"
          onClick={() => select(c.id)}
          aria-current={active ? 'true' : undefined}
          title={c.description || c.name}
          className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm transition-colors ${
            active ? 'bg-blue-50 text-blue-900' : 'text-gray-700 hover:bg-gray-100'
          } ${counted > 0 ? 'font-semibold text-gray-900' : ''}`}
        >
          <span className="relative inline-flex shrink-0">
            <ChannelIcon channel={c} />
            {c.kind === 'dm' && !c.group && c.partner && online.has(c.partner.id) && <OnlineDot />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{channelTitle(c)}</span>
            {status && <span className="block truncate text-xs font-normal text-gray-500">{status.text}</span>}
          </span>
          {level !== 'all' && (
            <span className="shrink-0 text-gray-400" title={level === 'off' ? 'Notifications off' : 'Only @mentions'}>
              <NotifyIcon level={level} className="h-3.5 w-3.5" />
            </span>
          )}
          {counted > 0 ? (
            <span className="min-w-[22px] rounded-full bg-blue-600 px-1.5 text-center text-xs font-bold leading-[20px] text-white"
              aria-label={level === 'mentions' ? `${counted} unread mentions` : `${counted} unread`}>
              {level === 'mentions' ? '@' : ''}{counted > 99 ? '99+' : counted}
            </span>
          ) : c.unread > 0 ? (
            // Quietened, with unread: still visible, but grey — it does not ask for attention.
            <span className="min-w-[22px] rounded-full bg-gray-200 px-1.5 text-center text-xs font-semibold leading-[20px] text-gray-600"
              aria-label={`${c.unread} unread (notifications ${level === 'off' ? 'off' : 'for @mentions only'})`}>
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          ) : (
            c.lastMessageAt && <span className="shrink-0 text-[11px] font-normal text-gray-500">{shortWhen(c.lastMessageAt)}</span>
          )}
        </button>
      </li>
    );
  };

  /** A collapsible list section, as in Google Chat. */
  const section = (key: string, label: string, items: ChatChannel[], empty: string, action?: React.ReactNode) => {
    const open = !collapsed.has(key);
    const unread = items.reduce((n, c) => n + loud(c), 0);
    return (
      <div className="mt-4 first:mt-1">
        <div className="flex items-center justify-between pl-1 pr-1">
          <button
            type="button"
            onClick={() => setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            })}
            className="flex items-center gap-1 rounded-lg px-1 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500 hover:text-gray-800"
            aria-expanded={open}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
            {label}
            {!open && unread > 0 && <span className="ml-1 h-2 w-2 rounded-full bg-blue-600" aria-label={`${unread} unread`} />}
          </button>
          {action}
        </div>
        {open && (
          <ul className="mt-1 space-y-0.5">
            {items.length === 0 && <li className="px-3 py-1 text-sm text-gray-400">{empty}</li>}
            {items.map(row)}
          </ul>
        )}
      </div>
    );
  };

  const mod = modKeyLabel();
  const shortcutGroups: ShortcutGroup[] = [
    { title: 'Moving around', items: [
      { keys: [mod, 'K'], label: 'Jump to a space, team or person' },
      { keys: ['Alt', '↑'], label: 'Previous conversation' },
      { keys: ['Alt', '↓'], label: 'Next conversation' },
      { keys: ['Esc'], label: 'Close a thread or a pop-up' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ] },
    { title: 'Writing a message', items: [
      { keys: ['Enter'], label: 'Send' },
      { keys: ['Shift', 'Enter'], label: 'New line' },
      { keys: ['@'], label: 'Mention a person or a team' },
      { keys: [mod, 'B'], label: 'Bold' },
      { keys: [mod, 'I'], label: 'Italic' },
    ] },
  ];

  return (
    // Below lg: edge to edge (cancelling the panel's padding), one pane at a time,
    // height fitted to the visible screen by useFitToViewport. From lg: list beside
    // the conversation, as before.
    <div
      ref={box}
      className="relative -mx-4 -mb-4 flex h-[calc(100dvh-4.5rem)] gap-0 overflow-hidden bg-[var(--pn-chat,#f2f6fc)] p-0 md:-mx-6 md:-mb-6 lg:mx-0 lg:mb-0 lg:h-[calc(100dvh-140px)] lg:min-h-[480px] lg:gap-2 lg:rounded-2xl lg:p-2"
    >
      <aside
        className={`w-full min-w-0 shrink-0 flex-col bg-white lg:flex lg:w-80 lg:rounded-2xl lg:shadow-sm ${selected ? 'hidden' : 'flex'}`}
        aria-label="Chat channels"
      >
        <div className="space-y-3 px-3 pb-2 pt-3">
          <div className="flex items-center gap-1">
            <h1 className="pn-title min-w-0 flex-1 truncate text-xl text-gray-900">
              Team chat
            </h1>
            <button
              type="button"
              onClick={() => setShowStarred(true)}
              className="grid h-9 w-9 place-items-center rounded-lg text-gray-600 hover:bg-gray-100"
              aria-label="Starred messages"
              title="Starred messages"
            >
              <Star className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setSearching('all')}
              className="grid h-9 w-9 place-items-center rounded-lg text-gray-600 hover:bg-gray-100"
              aria-label="Search all messages"
              title="Search all messages"
            >
              <Search className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setDialog('dm')}
              className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white shadow-sm hover:bg-blue-700"
              aria-label="New chat"
              title="New chat"
            >
              <MessageSquarePlus className="h-[18px] w-[18px]" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSwitcher(true)}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 text-left text-sm text-gray-500 transition-colors hover:border-gray-300 hover:bg-white"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Jump to…</span>
            <span className="hidden shrink-0 items-center gap-0.5 sm:flex"><Kbd>{mod}</Kbd><Kbd>K</Kbd></span>
          </button>
          <div className="flex items-center gap-1.5" role="group" aria-label="Show">
            {(['all', 'unread'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setShow(key)}
                aria-pressed={show === key}
                className={`h-7 rounded-full px-3 text-xs font-semibold transition-colors ${
                  show === key ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {key === 'all' ? 'All' : `Unread${totalUnread ? ` · ${totalUnread > 99 ? '99+' : totalUnread}` : ''}`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShortcuts(true)}
              className="ml-auto hidden h-7 w-7 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 sm:grid"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {isLoading && (
            <ul className="space-y-2 px-1 py-2" aria-label="Loading conversations">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex animate-pulse items-center gap-3 px-1">
                  <span className="h-7 w-7 rounded-xl bg-gray-100" />
                  <span className="h-3 flex-1 rounded bg-gray-100" />
                </li>
              ))}
            </ul>
          )}
          {isError && (
            <p className="px-3 py-4 text-sm text-gray-600">
              Couldn&apos;t load chat.{' '}
              <button type="button" className="font-semibold text-blue-700 underline" onClick={() => refetch()}>
                Retry
              </button>
            </p>
          )}
          {!isLoading && show === 'unread' && !spaces.length && !betweenTeams.length && !dms.length && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-gray-800">You’re all caught up</p>
              <p className="mt-1 text-xs text-gray-500">Nothing unread anywhere.</p>
              <button type="button" onClick={() => setShow('all')} className="mt-3 text-xs font-semibold text-blue-700 underline">Show all conversations</button>
            </div>
          )}

          {(show === 'all' || spaces.length > 0) && section('spaces', 'Spaces', spaces, 'No spaces',
            me?.canCreateSpace ? (
              <button type="button" onClick={() => setDialog('space')} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100" aria-label="New space" title="New space">
                <Plus className="h-4 w-4" />
              </button>
            ) : undefined)}
          {(show === 'all' || betweenTeams.length > 0) && section('teams', 'Between teams', betweenTeams, 'No team conversations')}
          {(show === 'all' || dms.length > 0) && section('dms', 'Direct messages', dms, 'No direct messages yet',
            <button type="button" onClick={() => setDialog('dm')} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100" aria-label="Start a direct message" title="Start a direct message">
              <Plus className="h-4 w-4" />
            </button>)}
        </div>

        <div className="flex items-center gap-2.5 border-t border-gray-100 px-3 py-2.5">
          <Avatar person={peopleById.get(meId) ?? { id: meId, name: meName, role: isAdmin ? 'admin' : 'staff', team: null, teamLabel: null, isHead: false }} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-gray-900">{meName}</span>
            <span className="block truncate text-xs text-gray-500">{myStatus ? myStatus.text : 'Active'}</span>
          </span>
          <button
            type="button"
            onClick={() => setEditingStatus(true)}
            className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            title="Set a status everyone in chat can see"
          >
            {myStatus ? 'Change status' : 'Set a status'}
          </button>
        </div>
      </aside>

      {selected ? (
        <Conversation
          key={selected.id}
          channel={selected}
          meId={meId}
          meName={meName}
          isAdmin={isAdmin}
          people={people}
          orderHref={orderHref}
          onBack={() => select(null)}
          onOpenChannel={select}
          online={online}
          onSearch={() => setSearching(selected.id)}
          initialTab={initialTab}
        />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-white px-6 text-center lg:flex">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-700">
            <MessageSquarePlus className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="pn-title text-lg text-gray-900">Pick a conversation</p>
          <p className="max-w-xs text-sm text-gray-500">Choose a space, team or person on the left — or press <Kbd>{modKeyLabel()}</Kbd> <Kbd>K</Kbd> to jump straight to one.</p>
        </div>
      )}

      {searching && (
        <MessageSearch
          channels={channels}
          scopeTo={searching === 'all' ? null : channels.find((c) => c.id === searching) ?? null}
          onPick={(id) => { setSearching(null); select(id); }}
          onClose={() => setSearching(null)}
        />
      )}

      {switcher && (
        <QuickSwitcher
          channels={channels}
          people={people}
          meId={meId}
          onPickChannel={(id) => { setSwitcher(false); select(id); }}
          onPickPerson={(id) => void openPerson(id)}
          onClose={() => setSwitcher(false)}
        />
      )}
      {shortcuts && <ShortcutsDialog groups={shortcutGroups} onClose={() => setShortcuts(false)} />}

      {editingStatus && <StatusDialog current={myStatus} onClose={() => setEditingStatus(false)} />}

      {showStarred && (
        <StarredPanel
          channels={channels}
          onPick={(id) => { setShowStarred(false); select(id); }}
          onClose={() => setShowStarred(false)}
        />
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
