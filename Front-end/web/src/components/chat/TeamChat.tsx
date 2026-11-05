'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, ChevronDown, MessagesSquare } from 'lucide-react';
import ChatSidebar from './ChatSidebar';
import { firstToOpen, homeList, listWhen, totalPeopleUnread } from './chatList';
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
import { Avatar, ChannelIcon, Dialog, OnlineDot, shortWhen } from './chatUi';
import QuickSwitcher, { channelTitle } from './QuickSwitcher';
import { Kbd, ShortcutsDialog, modKeyLabel, useHotkeys, type ShortcutGroup } from '@/components/panel/shortcuts';
import Conversation from './Conversation';
import { NotifyIcon } from './NotifyMenu';
import MessageSearch from './MessageSearch';
import StarredPanel from './StarredPanel';
import MentionsPanel from './MentionsPanel';
import ThreadsListPanel from './ThreadsListPanel';
import StatusDialog from './StatusDialog';
import { ONE_PANE_BELOW, useFitToViewport } from './useFitToViewport';
import { setOpenConversation } from '@/lib/chatSound';
import { plainLine } from './chatFormat';
import { clearTyping, noteTyping, useResetTypingOnUnmount } from '@/lib/chatTyping';
import './chat.css';

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
        className="mb-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-600"
      />
      <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
        {shown.length === 0 && <li className="p-3 text-sm text-gray-500">No one found</li>}
        {shown.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onToggle(p.id)}
              aria-pressed={selected.has(p.id)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 ${selected.has(p.id) ? 'bg-blue-50' : ''}`}
            >
              <Avatar person={p} online={online.has(p.id)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{p.name}</span>
                <span className="block truncate text-xs text-gray-500">
                  {p.teamLabel}{p.isHead ? ' · Head' : ''}{liveStatus(p.status) ? ` · ${liveStatus(p.status)!.text}` : ''}
                </span>
              </span>
              {!single && selected.has(p.id) && <span className="text-xs font-semibold text-blue-700">Added</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Up to 7 others: one is a direct message, more is a group conversation. */
const MAX_GROUP_OTHERS = 7;

/**
 * A chat's newest message (a list row's tooltip), Google Chat style —
 * "You: on my way", "Ravi: order shipped", or just the words in a one-to-one
 * DM (whoever is not me said them). Empty when the server sent no preview.
 */
export function homeLine(c: ChatChannel): string {
  const p = c.lastPreview;
  if (!p) return '';
  const words = p.deleted ? 'Message deleted' : plainLine(p.text);
  if (!words) return '';
  if (p.mine) return `You: ${words}`;
  if (c.kind === 'dm' && !c.group) return words;
  return p.by ? `${p.by}: ${words}` : words;
}

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
          className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
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
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-600"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">What is it for? (optional)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={240}
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-600"
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
          className="h-11 w-full rounded-full bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
  // Never-used chats are folded at the bottom of the list until asked for.
  const [showEmpty, setShowEmpty] = useState(false);
  // null = closed. 'all' = every channel I can see; otherwise one channel id.
  const [searching, setSearching] = useState<string | null>(null);
  const [showStarred, setShowStarred] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  // A thread to open in the conversation (picked from Mentions); `n` makes a repeat pick reopen it.
  const [threadRequest, setThreadRequest] = useState<{ channelId: string; id: string; n: number } | null>(null);
  // Desktop: the open conversation fills the chat area; the lists hide.
  const [wide, setWide] = useState(false);
  // Phones and tablets show one pane at a time: the sections, or Home (newest first).
  const [smallPane, setSmallPane] = useState<'nav' | 'home'>('nav');

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
  // ?th=<root>: a pop-up for a thread reply opens that thread, where the reply is.
  const threadParam = params.get('th');
  useEffect(() => {
    if (selectedId && threadParam) setThreadRequest({ channelId: selectedId, id: threadParam, n: Date.now() });
  }, [selectedId, threadParam]);

  const select = useCallback(
    (id: string | null) => {
      const q = new URLSearchParams(params.toString());
      // Picking a conversation by hand opens the tab its unread calls for, and no thread.
      q.delete('t');
      q.delete('th');
      if (id) q.set('c', id);
      else q.delete('c');
      router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Side by side, never show an empty pane: open where something is waiting
  // (the Chat button's number sent you here), else the newest chat. One pane at
  // a time (phones, tablets): start on the list, newest at the top.
  // Only once per visit: closing the conversation (×) shows Home, and must not
  // be undone by opening one again.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !channels.length) return;
    autoOpened.current = true;
    if (!selectedId && typeof window !== 'undefined' && window.innerWidth >= ONE_PANE_BELOW) {
      const first = firstToOpen(channels);
      if (first) select(first.id);
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

  useResetTypingOnUnmount();
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
        threadRoot?: string | null; userId?: string; name?: string;
      };
      if (e.type === 'typing' && e.channelId && e.userId) {
        // My own other tabs announce me too; I don't need to see myself.
        if (e.userId !== meId) noteTyping({ channelId: e.channelId, threadRoot: e.threadRoot ?? null, userId: e.userId, name: e.name ?? '' });
      } else if (e.type === 'message' && e.message && e.channelId) {
        if (e.message.sender?.id) clearTyping(e.channelId, e.message.sender.id);
        if (e.message.threadRoot) {
          // A reply: into its thread if open, and its root moves to the bottom.
          qc.setQueryData<ThreadData>(chatKeys.thread(e.message.threadRoot), (d) => upsertReply(d, e.message!));
          if (e.thread) qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) => applyThreadUpdate(d, e.thread!));
          qc.invalidateQueries({ queryKey: chatKeys.myThreads() });
        } else {
          qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) => upsertMessage(d, e.message!));
        }
        if (e.message.attachments?.length) qc.invalidateQueries({ queryKey: chatKeys.files(e.channelId) });
        if (e.message.mentionAll || e.message.mentionTeams?.length || e.message.mentions?.includes(meId)) {
          qc.invalidateQueries({ queryKey: chatKeys.mentions() });
        }
        scheduleChannelsRefresh();
      } else if (e.type === 'message_edited' && e.message && e.channelId) {
        qc.invalidateQueries({ queryKey: chatKeys.mentions() });
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
        qc.invalidateQueries({ queryKey: chatKeys.mentions() });
        // Admins see a deleted message's words; the broadcast carries only its id.
        qc.invalidateQueries({ queryKey: chatKeys.messages(e.channelId) });
        qc.invalidateQueries({ queryKey: [...chatKeys.all, 'thread'] });
        qc.invalidateQueries({ queryKey: chatKeys.files(e.channelId) });
        qc.invalidateQueries({ queryKey: chatKeys.pins(e.channelId) });
      } else if (e.type === 'message_deleted' && e.channelId && e.messageId) {
        qc.invalidateQueries({ queryKey: chatKeys.mentions() });
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

  // Messages from people only — the same number as the Chat button and the bell.
  const totalUnread = useMemo(() => totalPeopleUnread(channels), [channels]);

  // One list, as Google Chat's Home: newest first, never-used chats folded.
  const { active, empty } = useMemo(
    () => homeList(channels, { unreadOnly: show === 'unread', selectedId }),
    [channels, show, selectedId],
  );

  const openPerson = useCallback(async (personId: string) => {
    setSwitcher(false);
    try {
      const res = await openDm.mutateAsync([personId]);
      select(res.channel.id);
    } catch { /* the mutation's own error state; the list is unchanged */ }
    // openDm is a stable mutation object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  // Alt+↑ / Alt+↓ walk the list in the order it is drawn (folded chats skipped).
  const step = useCallback((by: number) => {
    const order = [...active, ...(showEmpty ? empty : [])];
    if (!order.length) return;
    const at = order.findIndex((c) => c.id === selectedId);
    const next = order[at < 0 ? 0 : (at + by + order.length) % order.length];
    select(next.id);
  }, [active, empty, showEmpty, selectedId, select]);

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

  /*
    A row as in Google Chat's Home: the name and the time of the newest message,
    the newest message underneath ("You: …", "Priya: …"). Messages from people
    waiting: bold, with a blue time and a blue number. Automatic order updates
    only get a grey "3 order updates", so a busy bot never shouts.
  */
  const row = (c: ChatChannel) => {
    const active = c.id === selectedId;
    const level = notifyOf(c);
    const { chat: fromPeople, updates } = countedUnread(c);
    const status = c.kind === 'dm' && !c.group && c.partner ? liveStatus(peopleById.get(c.partner.id)?.status) : null;
    const cap = (n: number) => (n > 99 ? '99+' : String(n));
    const waiting = fromPeople > 0;
    const line = homeLine(c) || status?.text || (c.lastMessageAt ? '' : 'No messages yet');
    return (
      <li key={c.id}>
        <button
          type="button"
          onClick={() => select(c.id)}
          aria-current={active ? 'true' : undefined}
          className="gc-row flex w-full items-center gap-4 rounded-2xl px-4 text-left"
        >
          <span className="relative inline-flex shrink-0">
            <ChannelIcon channel={c} size="lg" />
            {c.kind === 'dm' && !c.group && c.partner && online.has(c.partner.id) && <OnlineDot />}
          </span>
          <span className="gc-sep min-w-0 flex-1 py-3">
            <span className="flex items-baseline gap-2">
              {/* The round "#" icon already says it is a space, so the name drops its "#". */}
              <span className={`min-w-0 flex-1 truncate text-[15px] ${waiting ? 'font-bold text-gray-900' : active ? 'font-semibold text-gray-900' : 'text-gray-900'}`}>
                {c.kind === 'space' ? channelTitle(c).replace(/^#/, '') : channelTitle(c)}
              </span>
              {level !== 'all' && (
                <span className="shrink-0 self-center text-gray-400" title={level === 'off' ? 'Notifications off' : 'Only @mentions'}>
                  <NotifyIcon level={level} className="h-3.5 w-3.5" />
                </span>
              )}
              {c.lastMessageAt && (
                <span className={`shrink-0 text-xs ${waiting ? 'font-bold text-blue-700' : 'text-gray-500'}`}>{listWhen(c.lastMessageAt)}</span>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-2">
              <span className={`min-w-0 flex-1 truncate text-[13px] ${waiting ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{line}</span>
              {waiting ? (
                <span className="shrink-0 rounded-full bg-blue-700 px-1.5 text-[11px] font-bold leading-[18px] text-white"
                  aria-label={level === 'mentions' ? `${fromPeople} unread mentions` : `${fromPeople} unread`}>
                  {level === 'mentions' ? '@' : ''}{cap(fromPeople)}
                </span>
              ) : updates > 0 ? (
                <span className="shrink-0 rounded-full border border-gray-300 px-1.5 text-[11px] leading-[18px] text-gray-600">
                  {cap(updates)} order {updates === 1 ? 'update' : 'updates'}
                </span>
              ) : c.unread > 0 ? (
                // Quietened, with unread: still visible, but grey — it does not ask for attention.
                <span className="shrink-0 text-xs text-gray-500"
                  aria-label={`${c.unread} unread (notifications ${level === 'off' ? 'off' : 'for @mentions only'})`}>
                  {cap(c.unread)}
                </span>
              ) : null}
            </span>
          </span>
        </button>
      </li>
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

  const me_ = peopleById.get(meId) ?? { id: meId, name: meName, role: isAdmin ? 'admin' as const : 'staff' as const, team: null, teamLabel: null, isHead: false };
  const listHidden = wide && !!selected;
  // Which panes are on screen. Phones/tablets (below lg): one at a time. lg: the
  // sections plus Home OR the open chat. xl: sections, Home and the open chat.
  const navClass = selected ? 'hidden' : smallPane === 'nav' ? 'flex' : 'hidden';
  const homeClass = selected
    ? 'hidden xl:flex'
    : smallPane === 'home' ? 'flex' : 'hidden lg:flex';

  return (
    // Fills the panel's page edge to edge (cancelling its padding), its height
    // fitted to the visible screen by useFitToViewport. Laid out as Google Chat:
    // the sections on the page colour, then Home and the open conversation as
    // white rounded cards with a thin gap between. `isolate` keeps every layer
    // inside (the thread panel is a z-20 flex item) under the panel's top bar,
    // so the bell's drop-down is never drawn behind the chat.
    <div
      ref={box}
      className="gc-theme relative isolate -m-4 flex h-[calc(100dvh-3.5rem)] min-h-[320px] overflow-hidden md:-m-6 lg:-m-8 lg:gap-2 lg:py-2 lg:pr-2"
    >
      <aside
        className={`${navClass} w-full min-w-0 shrink-0 flex-col bg-[var(--gc-page)] lg:w-[272px] ${listHidden ? 'lg:hidden' : 'lg:flex'}`}
        aria-label="Chat channels"
      >
        <ChatSidebar
          channels={channels}
          selectedId={selectedId}
          homeOn={!selected || smallPane === 'home'}
          online={online}
          canCreateSpace={!!me?.canCreateSpace}
          onSelect={select}
          onHome={() => { setSmallPane('home'); setWide(false); select(null); }}
          onNewChat={() => setDialog('dm')}
          onNewSpace={() => setDialog('space')}
          onSearch={() => setSearching('all')}
          onMentions={() => setShowMentions(true)}
          onThreads={() => setShowThreads(true)}
          onStarred={() => setShowStarred(true)}
          onShortcuts={() => setShortcuts(true)}
          footer={(
            <div className="flex items-center gap-2.5 border-t border-gray-200 px-4 py-2.5">
              <Avatar person={me_} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{meName}</span>
                <span className="block truncate text-xs text-gray-500">{myStatus ? myStatus.text : 'Active'}</span>
              </span>
              <button
                type="button"
                onClick={() => setEditingStatus(true)}
                className="gc-icon-btn shrink-0 rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
                title="Set a status everyone in chat can see"
              >
                {myStatus ? 'Change status' : 'Set a status'}
              </button>
            </div>
          )}
        />
      </aside>

      <section
        className={`${homeClass} gc-card gc-pane min-h-0 w-full min-w-0 flex-col lg:flex-1 lg:rounded-2xl xl:w-[400px] xl:flex-none 2xl:w-[440px] ${listHidden ? 'xl:hidden' : ''}`}
        aria-label="Home"
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-3 lg:px-6 lg:pt-4">
          <button type="button" onClick={() => setSmallPane('nav')} className="gc-icon-btn -ml-2 grid h-10 w-10 place-items-center rounded-full text-gray-600 lg:hidden" aria-label="Back to sections">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-[22px] font-normal text-gray-900">Home</h2>
          <button
            type="button"
            role="switch"
            aria-checked={show === 'unread'}
            aria-label={`Unread only${totalUnread ? `, ${totalUnread} waiting` : ''}`}
            onClick={() => setShow(show === 'unread' ? 'all' : 'unread')}
            title="Show only chats where someone wrote something new"
            className="flex items-center gap-2.5 rounded-full py-1 pl-2 pr-1 text-sm font-medium text-gray-800"
          >
            Unread{totalUnread ? <span className="text-xs font-bold text-blue-700">{totalUnread > 99 ? '99+' : totalUnread}</span> : null}
            <span className="gc-switch" data-on={show === 'unread'} aria-hidden="true"><span /></span>
          </button>
        </div>

        <div className="gc-scroll gc-home min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {isLoading && (
            <ul className="space-y-3 px-3 py-2" aria-label="Loading conversations">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex items-center gap-4">
                  <span className="gc-shimmer h-10 w-10 shrink-0 rounded-full" />
                  <span className="flex-1 space-y-2">
                    <span className="gc-shimmer block h-3 w-2/5 rounded-full" />
                    <span className="gc-shimmer block h-2.5 w-4/5 rounded-full" />
                  </span>
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
          {!isLoading && show === 'unread' && !active.length && (
            <div className="px-4 py-10 text-center">
              <span className="gc-hero mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full" aria-hidden="true">
                <CheckCheck className="h-7 w-7 text-blue-600" />
              </span>
              <p className="text-[15px] font-medium text-gray-800">You’re all caught up</p>
              <p className="mt-1 text-sm text-gray-500">Nobody is waiting for a reply.</p>
              <button type="button" onClick={() => setShow('all')} className="mt-3 text-sm font-medium text-blue-700 hover:underline">Show all chats</button>
            </div>
          )}

          {!isLoading && !isError && (
            <ul aria-label="Chats, newest first">
              {active.map(row)}
              {showEmpty && empty.map(row)}
            </ul>
          )}
          {empty.length > 0 && (
            <button
              type="button"
              onClick={() => setShowEmpty((v) => !v)}
              className="gc-icon-btn mt-1 flex w-full items-center gap-1.5 rounded-full px-4 py-2 text-left text-[13px] font-medium text-blue-700"
              aria-expanded={showEmpty}
            >
              <ChevronDown className={`gc-caret h-4 w-4 ${showEmpty ? 'rotate-180' : ''}`} aria-hidden="true" />
              {showEmpty ? 'Hide chats with no messages yet' : `Show ${empty.length} ${empty.length === 1 ? 'chat' : 'chats'} with no messages yet`}
            </button>
          )}
        </div>
      </section>

      {selected ? (
        <Conversation
          key={selected.id}
          channel={selected}
          meId={meId}
          meName={meName}
          isAdmin={isAdmin}
          people={people}
          orderHref={orderHref}
          onBack={() => { setWide(false); select(null); }}
          onOpenChannel={select}
          online={online}
          onSearch={() => setSearching(selected.id)}
          initialTab={initialTab}
          expanded={wide}
          onToggleExpand={() => setWide((v) => !v)}
          openThread={threadRequest?.channelId === selected.id ? threadRequest : null}
        />
      ) : (
        <div className="gc-card gc-pane hidden flex-1 flex-col items-center justify-center gap-2 rounded-2xl px-6 text-center xl:flex">
          <span className="gc-hero mb-2 grid h-24 w-24 place-items-center rounded-full" aria-hidden="true">
            <MessagesSquare className="h-10 w-10 text-blue-600" strokeWidth={1.75} />
          </span>
          <p className="text-[18px] font-normal text-gray-900">Pick a chat to read it here</p>
          <p className="max-w-xs text-sm text-gray-500">Tip: press <Kbd>{mod}</Kbd> <Kbd>K</Kbd> to find any person or space by name.</p>
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

      {showMentions && (
        <MentionsPanel
          channels={channels}
          onPick={(id, threadRoot) => {
            setShowMentions(false);
            setThreadRequest(threadRoot ? { channelId: id, id: threadRoot, n: Date.now() } : null);
            select(id);
          }}
          onClose={() => setShowMentions(false)}
        />
      )}

      {showThreads && (
        <ThreadsListPanel
          channels={channels}
          onPick={(id, rootId) => {
            setShowThreads(false);
            setThreadRequest({ channelId: id, id: rootId, n: Date.now() });
            select(id);
          }}
          onClose={() => setShowThreads(false)}
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
