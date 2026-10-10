'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, Download, Users } from 'lucide-react';
import { chatKeys } from '@/hooks/queries/keys';
import {
  upsertMessage,
  useChannelFiles,
  useChatMessages,
  useDeleteMessage,
  useMarkRead,
  useSendMessage,
} from '@/hooks/queries/useTeamChat';
import type { ChatChannel, ChatMessage, ChatPerson, MessagePage, SendVars } from '@/hooks/queries/useTeamChat';
import { Avatar, FileKindIcon, fileSize, timeOf } from './chatUi';
import Composer from './Composer';
import MessageItem from './MessageItem';

type Pages = InfiniteData<MessagePage, number>;

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
}: {
  channel: ChatChannel;
  meId: string;
  meName: string;
  isAdmin: boolean;
  people: ChatPerson[];
  orderHref: (id: string) => string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } =
    useChatMessages(channel.id);
  const send = useSendMessage(channel.id);
  const markRead = useMarkRead();
  const del = useDeleteMessage();
  const [tab, setTab] = useState<'messages' | 'files'>('messages');
  const [atBottom, setAtBottom] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);

  const messages = useMemo(
    () => (data?.pages ?? []).slice().reverse().flatMap((p) => p.messages),
    [data],
  );
  const lastSeq = messages.reduce((n, m) => (!m.pending && m.seq > n ? m.seq : n), 0);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

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
  }, [messages.length, tab]);

  useEffect(() => {
    stickToBottom.current = true;
    setAtBottom(true);
    setTab('messages');
  }, [channel.id]);

  const read = useCallback(
    (seq: number) => {
      if (seq > channel.lastReadSeq) markRead.mutate({ channelId: channel.id, seq });
    },
    // markRead is a stable mutation object; depending on it would re-create this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel.id, channel.lastReadSeq],
  );

  // Reading = the newest message is on screen and the tab is actually visible.
  useEffect(() => {
    if (!lastSeq || !stickToBottom.current) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    read(lastSeq);
  }, [lastSeq, read]);

  const latest = useRef({ lastSeq });
  latest.current = { lastSeq };
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && stickToBottom.current) read(latest.current.lastSeq);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [read]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = bottom;
    setAtBottom(bottom);
    if (el.scrollTop < 120 && hasNextPage && !isFetchingNextPage) {
      restoreFrom.current = el.scrollHeight - el.scrollTop;
      fetchNextPage();
    }
    if (bottom) read(lastSeq);
  };

  const scrollToBottom = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTop = el.scrollHeight;
    read(lastSeq);
  };

  /** Show the message immediately, then reconcile with what the server stored. */
  const doSend = (vars: SendVars) => {
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
      createdAt: new Date().toISOString(),
      pending: true,
    };
    stickToBottom.current = true;
    qc.setQueryData<Pages>(chatKeys.messages(channel.id), (d) => upsertMessage(d, optimistic));
    send.mutate(vars, {
      onError: () =>
        qc.setQueryData<Pages>(chatKeys.messages(channel.id), (d) =>
          upsertMessage(d, { ...optimistic, pending: false, failed: true }),
        ),
    });
  };

  const title = channel.kind === 'dm' ? channel.name : `#${channel.name}`;
  const subtitle =
    channel.kind === 'dm'
      ? [channel.partner?.teamLabel, channel.partner?.isHead ? 'Head' : null].filter(Boolean).join(' · ')
      : channel.description;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-white" aria-label={`Conversation ${title}`}>
      <header className="border-b border-gray-200 px-4 pt-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 md:hidden" aria-label="Back to channels">
            <ArrowLeft className="h-5 w-5" />
          </button>
          {channel.kind === 'dm' && <Avatar person={channel.partner} size="sm" />}
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
          </div>
          {channel.kind === 'space' && channel.memberCount != null && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500">
              <Users className="h-4 w-4" /> {channel.memberCount}
            </span>
          )}
        </div>
        <div className="mt-2 flex gap-4" role="tablist" aria-label="Conversation sections">
          {(['messages', 'files'] as const).map((key) => (
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
              {key}
            </button>
          ))}
        </div>
      </header>

      {tab === 'files' ? (
        <FilesPanel channelId={channel.id} />
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-3" aria-live="polite">
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
                  <p className="text-sm text-gray-500">Say hello, share a photo, or link an order to get started.</p>
                </div>
              )}

              {messages.map((m, i) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  previous={messages[i - 1]}
                  meId={meId}
                  meName={meName}
                  peopleById={peopleById}
                  canDelete={m.sender?.id === meId || isAdmin}
                  orderHref={orderHref}
                  onDelete={(msg) => { if (confirm('Delete this message?')) del.mutate(msg); }}
                  onRetry={(msg) => doSend({ text: msg.text, clientId: msg.clientId ?? '', mentions: msg.mentions })}
                />
              ))}
            </div>

            {!atBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
              >
                <ArrowDown className="h-3.5 w-3.5" /> Newest messages
              </button>
            )}
          </div>

          <Composer
            channelName={title}
            people={people.filter((p) => p.id !== meId)}
            canMentionTeams={channel.kind === 'space' && channel.audience !== 'members'}
            onSend={doSend}
          />
        </>
      )}
    </section>
  );
}

export { timeOf };
