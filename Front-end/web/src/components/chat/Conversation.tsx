'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, Download, Search, Users } from 'lucide-react';
import { chatKeys } from '@/hooks/queries/keys';
import {
  readUpdatesSeqOf,
  unreadChatOf,
  unreadUpdatesOf,
  upsertMessage,
  useChannelFiles,
  useChatMessages,
  useMarkRead,
  useSendMessage,
  useEditMessage,
  useDeleteMessage,
  useReactToMessage,
} from '@/hooks/queries/useTeamChat';
import type { ChatChannel, ChatMessage, ChatPerson, MessagePage, ReadPart, SendVars } from '@/hooks/queries/useTeamChat';
import { useResendStore } from './resend';
import MembersPanel from './MembersPanel';
import { Avatar, ChannelIcon, FileKindIcon, fileSize, timeOf } from './chatUi';
import Composer, { mentionableTeams } from './Composer';
import MessageItem, { messageDomId } from './MessageItem';
import ThreadPanel from './ThreadPanel';

type Pages = InfiniteData<MessagePage, number>;
type Tab = 'messages' | 'updates' | 'files' | 'members';

/** Where a top-level message sits by its latest activity (a thread's newest reply counts). */
const activityOf = (m: ChatMessage) => m.activitySeq ?? m.seq;

/** The newest activity among these top-level messages (pending sends excluded). */
const newestOf = (list: ChatMessage[]) => list.reduce((n, m) => (!m.pending && activityOf(m) > n ? activityOf(m) : n), 0);

/** Open on Order updates when that is the only thing waiting; otherwise on Chat. */
function defaultTab(channel: ChatChannel): Tab {
  return channel.kind === 'space' && unreadChatOf(channel) === 0 && unreadUpdatesOf(channel) > 0 ? 'updates' : 'messages';
}

/** Everything shared in this channel, newest first. */
function FilesPanel({ channelId }: { channelId: string }) {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useChannelFiles(channelId, true);
  const files = (data?.pages ?? []).flatMap((p) => p.files);

  if (isLoading) return <p className="p-6 text-sm text-gray-500">Loading files…</p>;
  if (isError) {
    return (
      <p className="p-6 text-sm text-gray-600">
        Couldn&apos;t load the files.{' '}
        <button type="button" className="font-semibold text-emerald-700 underline" onClick={() => refetch()}>
          Try again
        </button>
      </p>
    );
  }
  if (!files.length) {
    return (
      <div className="p-10 text-center">
        <p className="text-base font-semibold text-gray-800">No files yet</p>
        <p className="text-sm text-gray-500">Photos and documents shared here will be collected on this tab.</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.id}>
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              download={f.name}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2.5 hover:border-emerald-600 hover:bg-emerald-50"
            >
              {f.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-gray-100 text-gray-600">
                  <FileKindIcon mime={f.mime} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{f.name}</span>
                <span className="block text-xs text-gray-500">
                  {fileSize(f.size)} · {f.sharedBy?.name ?? 'Someone'} ·{' '}
                  {new Date(f.sharedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </span>
              <Download className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mt-3 w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {isFetchingNextPage ? 'Loading…' : 'Show older files'}
        </button>
      )}
    </div>
  );
}

export default function Conversation({
  channel,
  meId,
  meName,
  isAdmin,
  people,
  orderHref,
  onBack,
  onSearch,
  initialTab,
}: {
  channel: ChatChannel;
  meId: string;
  meName: string;
  isAdmin: boolean;
  people: ChatPerson[];
  orderHref: (id: string) => string;
  onBack: () => void;
  /** Opens search already narrowed to this channel. */
  onSearch?: () => void;
  /** From the link (?t=updates — an order-update pop-up); otherwise chosen by what is unread. */
  initialTab?: 'messages' | 'updates';
}) {
  const qc = useQueryClient();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } =
    useChatMessages(channel.id);
  const send = useSendMessage(channel.id);
  const edit = useEditMessage(channel.id);
  const remove = useDeleteMessage(channel.id);
  const react = useReactToMessage(channel.id, meId);
  const markRead = useMarkRead();
  const [tab, setTab] = useState<Tab>(() => {
    if (initialTab === 'updates') return channel.kind === 'space' ? 'updates' : 'messages';
    return initialTab ?? defaultTab(channel);
  });
  // Custom groups have a member list; team spaces and DMs do not.
  const isGroup = channel.kind === 'space' && channel.audience === 'members';
  const [quote, setQuote] = useState<ChatMessage | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [thread, setThread] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);

  const messages = useMemo(
    () => (data?.pages ?? []).slice().reverse().flatMap((p) => p.messages),
    [data],
  );
  /*
    "Chat" is what people wrote; "Order updates" is what the system posted (orders,
    payments, transfers, refunds). One loaded timeline, two views of it — so the
    live stream, sending, editing and read-marking all keep working on one cache.
  */
  const chatMessages = useMemo(() => messages.filter((m) => m.kind !== 'system'), [messages]);
  // Order updates read newest first: the order that moved last is the one to look at.
  const updateMessages = useMemo(
    () => messages.filter((m) => m.kind === 'system').sort((a, b) => activityOf(b) - activityOf(a)),
    [messages],
  );
  const visible = tab === 'updates' ? updateMessages : chatMessages;
  // Team spaces get automatic updates; direct messages never do.
  const hasUpdatesTab = channel.kind === 'space';
  /*
    The newest thing in each tab — a thread's activity counts, since replies are
    read from the timeline's summary of them. Chat and Order updates are read
    separately, so opening one never clears the other's unread.
  */
  const lastChatSeq = newestOf(chatMessages);
  const lastUpdatesSeq = newestOf(updateMessages);

  /*
    "Unread" labels on Order updates: what was past the read position when the
    tab was opened. Taken once per visit, so the labels stay while you look and
    are gone the next time you open the tab — even though the tab is marked read
    as soon as it is on screen. null until taken (no flash of labels).
  */
  const [unreadFrom, setUnreadFrom] = useState<number | null>(null);
  useEffect(() => {
    setUnreadFrom(tab === 'updates' ? readUpdatesSeqOf(channel) : null);
    // Only on entering the tab: the read position moves while it is open, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, channel.id]);

  // A pop-up for an order update can land on this same conversation while it is open.
  useEffect(() => {
    if (initialTab === 'updates' && hasUpdatesTab) setTab('updates');
  }, [initialTab, hasUpdatesTab]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // Order updates start at the top, where the newest is.
  useLayoutEffect(() => {
    if (tab === 'updates' && scroller.current) scroller.current.scrollTop = 0;
  }, [tab]);

  // Stay pinned to the newest message; hold position when older ones load above.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || tab !== 'messages') return;
    if (restoreFrom.current != null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visible.length, tab]);

  /*
    A tab whose messages are sparse in the loaded pages (a busy updates channel can
    fill 50 messages without one human line) would have nothing to scroll, so the
    scroll-up "load older" never fires. Load older pages until there is a screenful,
    or the history runs out — bounded, so it can never loop.
  */
  const autoLoads = useRef(0);
  useEffect(() => { autoLoads.current = 0; }, [channel.id, tab]);
  useEffect(() => {
    if ((tab !== 'messages' && tab !== 'updates') || isLoading || isFetchingNextPage || !hasNextPage) return;
    if (visible.length >= 20 || autoLoads.current >= 8) return;
    autoLoads.current += 1;
    fetchNextPage();
  }, [tab, visible.length, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage]);

  useEffect(() => {
    stickToBottom.current = true;
    setAtBottom(true);
    setThread(null);
    setQuote(null);
  }, [channel.id]);

  /** Scroll to a quoted message and flash it. Older than what is loaded: say so. */
  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(messageDomId(id));
    if (!el) {
      alert('That message is further back — scroll up to load older messages.');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('chat-flash');
    setTimeout(() => el.classList.remove('chat-flash'), 1600);
  }, []);

  const readUpdatesSeq = readUpdatesSeqOf(channel);
  const read = useCallback(
    (part: ReadPart, seq: number) => {
      const from = part === 'updates' ? readUpdatesSeq : channel.lastReadSeq;
      if (seq > from) markRead.mutate({ channelId: channel.id, seq, part });
    },
    // markRead is a stable mutation object; depending on it would re-create this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel.id, channel.lastReadSeq, readUpdatesSeq],
  );

  /*
    Reading = the tab is actually visible and: Chat — its newest message is on
    screen (pinned to the bottom); Order updates — the tab is open (the newest
    is at the top, so it is on screen the moment the tab is), after its
    "Unread" labels were taken.
  */
  const readNow = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (tab === 'messages' && lastChatSeq && stickToBottom.current) read('chat', lastChatSeq);
    if (tab === 'updates' && lastUpdatesSeq && unreadFrom !== null) read('updates', lastUpdatesSeq);
  }, [tab, lastChatSeq, lastUpdatesSeq, unreadFrom, read]);
  useEffect(() => { readNow(); }, [readNow]);

  useEffect(() => {
    const onVisible = () => readNow();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [readNow]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    // Order updates run newest first: older ones load at the bottom, nothing to hold.
    if (tab === 'updates') {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && hasNextPage && !isFetchingNextPage) fetchNextPage();
      return;
    }
    stickToBottom.current = bottom;
    setAtBottom(bottom);
    if (el.scrollTop < 120 && hasNextPage && !isFetchingNextPage) {
      restoreFrom.current = el.scrollHeight - el.scrollTop;
      fetchNextPage();
    }
    if (bottom) read('chat', lastChatSeq);
  };

  const scrollToBottom = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTop = el.scrollHeight;
    read('chat', lastChatSeq);
  };

  /** Show the message immediately, then reconcile with what the server stored. */
  const resend = useResendStore();
  const retry = (msg: ChatMessage) => doSend(resend.varsFor(msg));

  const doSend = (vars: SendVars) => {
    resend.remember(vars);
    const optimistic: ChatMessage = {
      id: `pending-${vars.clientId}`,
      channelId: channel.id,
      seq: Number.MAX_SAFE_INTEGER,
      kind: 'user',
      text: vars.text,
      deleted: false,
      sender: { id: meId, name: meName, role: isAdmin ? 'admin' : 'staff', team: null, teamLabel: null, isHead: false },
      clientId: vars.clientId,
      attachments: [],
      mentions: vars.mentions ?? [],
      mentionTeams: vars.mentionTeams ?? [],
      refs: [],
      quote: quote && vars.quoteId === quote.id
        ? { id: quote.id, seq: quote.seq, by: quote.kind === 'system' ? 'Roavion updates' : quote.sender?.name ?? '', preview: quote.text }
        : null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    stickToBottom.current = true;
    qc.setQueryData<Pages>(chatKeys.messages(channel.id), (d) => upsertMessage(d, optimistic));
    send.mutate(vars, {
      onSuccess: () => resend.forget(vars.clientId),
      onError: () =>
        qc.setQueryData<Pages>(chatKeys.messages(channel.id), (d) =>
          upsertMessage(d, { ...optimistic, pending: false, failed: true }),
        ),
    });
  };

  const title = channel.kind === 'dm' ? channel.name : channel.audience === 'teams' ? channel.name : `#${channel.name}`;
  const subtitle =
    channel.kind === 'dm'
      ? [channel.partner?.teamLabel, channel.partner?.isHead ? 'Head' : null].filter(Boolean).join(' · ')
      : channel.description;

  return (
    <div className="relative flex h-full min-h-0 flex-1">
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white md:rounded-2xl" aria-label={`Conversation ${title}`}>
        <header className="border-b border-gray-100 px-4 pt-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onBack} className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 md:hidden" aria-label="Back to channels">
              <ArrowLeft className="h-5 w-5" />
            </button>
            {channel.kind === 'dm' ? <Avatar person={channel.partner} /> : <ChannelIcon channel={channel} size="md" />}
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-gray-900">{title}</h2>
              {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {channel.kind === 'space' && channel.memberCount != null && (
                <button type="button" onClick={() => setTab('members')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100" aria-label={`${channel.memberCount} members — open member list`}>
                  <Users className="h-4 w-4" /> {channel.memberCount}
                </button>
              )}
              {onSearch && (
                <button
                  type="button"
                  onClick={onSearch}
                  className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
                  aria-label={`Search in ${title}`}
                  title={`Search in ${title}`}
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 flex gap-4" role="tablist" aria-label="Conversation sections">
            {([
              'messages',
              ...(hasUpdatesTab ? (['updates'] as const) : []),
              'files',
              ...(isGroup ? (['members'] as const) : []),
            ] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 pb-2 text-sm font-medium capitalize ${
                  tab === key ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {key === 'messages' ? 'Chat' : key === 'updates' ? 'Order updates' : key === 'files' ? 'Files' : 'Members'}
                {(() => {
                  const n = key === 'messages' ? unreadChatOf(channel) : key === 'updates' ? unreadUpdatesOf(channel) : 0;
                  return n > 0 && (
                    <span className="ml-1.5 rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold leading-[18px] text-white" aria-label={`${n} unread`}>
                      {n > 99 ? '99+' : n}
                    </span>
                  );
                })()}
              </button>
            ))}
          </div>
        </header>

        {tab === 'members' && isGroup ? (
          <MembersPanel channelId={channel.id} onDeleted={onBack} />
        ) : tab === 'files' ? (
          <FilesPanel channelId={channel.id} />
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-3" aria-live="polite">
                {tab === 'messages' && isFetchingNextPage && <p className="py-2 text-center text-xs text-gray-500">Loading older messages…</p>}
                {tab === 'messages' && !hasNextPage && !isLoading && visible.length > 0 && (
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
                {!isLoading && !isError && visible.length === 0 && tab === 'updates' && (
                  <div className="py-16 text-center">
                    <p className="text-base font-semibold text-gray-800">No order updates here yet</p>
                    <p className="text-sm text-gray-500">Automatic updates about orders, payments and refunds for this space appear here.</p>
                  </div>
                )}
                {!isLoading && !isError && visible.length === 0 && tab === 'messages' && (
                  <div className="py-16 text-center">
                    <div className="mx-auto mb-3 w-fit"><ChannelIcon channel={channel} size="md" /></div>
                    <p className="text-base font-semibold text-gray-800">No messages yet</p>
                    <p className="text-sm text-gray-500">
                      {channel.audience === 'teams'
                        ? `Only ${channel.description || 'these two teams'} (and admin) can see this conversation.`
                        : 'Say hello, share a photo, or link an order to get started.'}
                    </p>
                  </div>
                )}

                {visible.map((m, i) => (
                  <div key={m.id}>
                  {tab === 'updates' && unreadFrom !== null && activityOf(m) > unreadFrom && (
                    <span className="mt-2 inline-block rounded-full bg-red-600 px-2 text-[11px] font-bold uppercase leading-5 tracking-wide text-white">
                      Unread
                    </span>
                  )}
                  <MessageItem
                    message={m}
                    previous={visible[i - 1]}
                    meId={meId}
                    meName={meName}
                    peopleById={peopleById}
                    orderHref={orderHref}
                    onRetry={retry}
                    onOpenThread={(msg) => setThread(msg.id)}
                    onQuote={setQuote}
                    onJumpTo={jumpTo}
                    onEdit={(msg, text) => edit.mutateAsync({ id: msg.id, text })}
                    onDelete={(msg) => remove.mutateAsync(msg.id)}
                    onReact={(msg, emoji, on) => react.mutate({ message: msg, emoji, on })}
                  />
                  </div>
                ))}
                {tab === 'updates' && isFetchingNextPage && <p className="py-2 text-center text-xs text-gray-500">Loading older updates…</p>}
                {tab === 'updates' && !hasNextPage && !isLoading && visible.length > 0 && (
                  <p className="py-3 text-center text-xs text-gray-400">No older updates in {title}</p>
                )}
              </div>

              {tab === 'messages' && !atBottom && (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
                >
                  <ArrowDown className="h-3.5 w-3.5" /> Newest messages
                </button>
              )}
            </div>

            {tab === 'messages' && (
            <Composer
              channelName={title}
              people={people.filter((p) => p.id !== meId)}
              teams={mentionableTeams(channel)}
              onSend={doSend}
              quote={quote}
              onClearQuote={() => setQuote(null)}
            />
            )}
          </>
        )}
      </section>
      {thread && (
        <ThreadPanel
          channel={channel}
          rootId={thread}
          meId={meId}
          meName={meName}
          isAdmin={isAdmin}
          people={people}
          peopleById={peopleById}
          orderHref={orderHref}
          onClose={() => setThread(null)}
        />
      )}
    </div>
  );
}

export { timeOf };
