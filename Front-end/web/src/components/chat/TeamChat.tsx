'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { MessageSquarePlus, Plus, Search } from 'lucide-react';
import { useSSE } from '@/hooks/useSSE';
import { useAuth } from '@/context/AuthContext';
import { chatKeys } from '@/hooks/queries/keys';
import {
  upsertMessage,
  useCanChat,
  useChatChannels,
  useChatMe,
  useChatPeople,
  useCreateSpace,
  useOpenDm,
} from '@/hooks/queries/useTeamChat';
import type { ChatChannel, ChatMessage, ChatPerson, MessagePage } from '@/hooks/queries/useTeamChat';
import { Avatar, ChannelIcon, Dialog, GREEN } from './chatUi';
import Conversation from './Conversation';

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
  return (
    <Dialog title="New message" onClose={onClose}>
      <PeoplePicker
        people={people.filter((p) => p.id !== meId)}
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
  const [dialog, setDialog] = useState<'space' | 'dm' | null>(null);
  const [filter, setFilter] = useState('');

  const meId = me?.userId ?? '';
  const meName = user?.name ?? 'You';
  const isAdmin = user?.role === 'admin';
  // Admins manage orders in their own panel; staff see them in the team panel.
  const orderHref = useCallback(
    (id: string) => (isAdmin ? `/admin/orders?order=${id}` : '/team/orders'),
    [isAdmin],
  );

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

  // On a wide screen never show an empty pane; on phones start on the list.
  useEffect(() => {
    if (!selectedId && channels.length && typeof window !== 'undefined' && window.innerWidth >= 768) {
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
      const e = event as unknown as { type: string; channelId?: string; message?: ChatMessage; messageId?: string };
      if (e.type === 'message' && e.message && e.channelId) {
        qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) => upsertMessage(d, e.message!));
        if (e.message.attachments?.length) qc.invalidateQueries({ queryKey: chatKeys.files(e.channelId) });
        scheduleChannelsRefresh();
      } else if (e.type === 'message_deleted' && e.channelId && e.messageId) {
        qc.setQueryData<Pages>(chatKeys.messages(e.channelId), (d) =>
          d
            ? {
                ...d,
                pages: d.pages.map((p) => ({
                  ...p,
                  messages: p.messages.map((m) =>
                    m.id === e.messageId ? { ...m, deleted: true, text: '', attachments: [], refs: [] } : m,
                  ),
                })),
              }
            : d,
        );
        qc.invalidateQueries({ queryKey: chatKeys.files(e.channelId) });
      } else if (e.type === 'channel') {
        scheduleChannelsRefresh();
      }
    },
    // A dropped connection means missed events: re-sync on reconnect.
    onConnect: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
      if (selectedId) qc.invalidateQueries({ queryKey: chatKeys.messages(selectedId) });
    },
  });

  const totalUnread = useMemo(() => channels.reduce((n, c) => n + c.unread, 0), [channels]);

  if (!canChat) {
    return <p className="p-6 text-gray-600">Team chat is available to staff and admins only.</p>;
  }

  const term = filter.trim().toLowerCase();
  const visible = channels.filter((c) => !term || c.name.toLowerCase().includes(term));
  const spaces = visible.filter((c) => c.kind === 'space');
  const dms = visible.filter((c) => c.kind === 'dm');

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
        <div className="px-4 pb-2 pt-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">
              Team chat
              {totalUnread > 0 && <span className="ml-2 align-middle text-xs font-semibold text-emerald-700">{totalUnread} new</span>}
            </h1>
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
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a space or person"
              aria-label="Find a space or person"
              className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-emerald-600"
            />
          </div>
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
          <ul className="mt-1 space-y-0.5">
            {spaces.length === 0 && <li className="px-3 py-1 text-sm text-gray-400">No spaces match</li>}
            {spaces.map(row)}
          </ul>

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
        <Conversation
          key={selected.id}
          channel={selected}
          meId={meId}
          meName={meName}
          isAdmin={isAdmin}
          people={people}
          orderHref={orderHref}
          onBack={() => select(null)}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-gray-500 md:flex">
          Pick a space or person to start chatting
        </div>
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
