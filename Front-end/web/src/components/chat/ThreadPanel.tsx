'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { chatKeys } from '@/hooks/queries/keys';
import { upsertReply, useDeleteMessage, useSendMessage, useThread } from '@/hooks/queries/useTeamChat';
import type { ChatChannel, ChatMessage, ChatPerson, SendVars, ThreadData } from '@/hooks/queries/useTeamChat';
import Composer from './Composer';
import MessageItem from './MessageItem';

/**
 * One thread: the message it hangs from, its replies, and a composer that
 * replies in it. On a wide screen it sits beside the conversation; on a phone
 * it covers it, with a close button back to the channel.
 *
 * Replies arrive live through the same stream as the timeline (TeamChat writes
 * them into this query's cache), so nothing here polls.
 */
export default function ThreadPanel({
  channel,
  rootId,
  meId,
  meName,
  isAdmin,
  people,
  peopleById,
  orderHref,
  onClose,
}: {
  channel: ChatChannel;
  rootId: string;
  meId: string;
  meName: string;
  isAdmin: boolean;
  people: ChatPerson[];
  peopleById: Map<string, ChatPerson>;
  orderHref: (id: string) => string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useThread(rootId);
  const send = useSendMessage(channel.id);
  const del = useDeleteMessage();
  const scroller = useRef<HTMLDivElement>(null);
  const replies = data?.replies ?? [];

  // Newest reply in view, as in the conversation.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length, rootId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      threadRoot: rootId,
      pending: true,
    };
    const key = chatKeys.thread(rootId);
    qc.setQueryData<ThreadData>(key, (d) => upsertReply(d, optimistic));
    send.mutate({ ...vars, threadRoot: rootId }, {
      onError: () => qc.setQueryData<ThreadData>(key, (d) => upsertReply(d, { ...optimistic, pending: false, failed: true })),
    });
  };

  const item = (m: ChatMessage, previous?: ChatMessage) => (
    <MessageItem
      key={m.id}
      message={m}
      previous={previous}
      meId={meId}
      meName={meName}
      peopleById={peopleById}
      canDelete={m.sender?.id === meId || isAdmin}
      orderHref={orderHref}
      onDelete={(msg) => { if (confirm('Delete this message?')) del.mutate(msg); }}
      onRetry={(msg) => doSend({ text: msg.text, clientId: msg.clientId ?? '', mentions: msg.mentions })}
    />
  );

  return (
    <aside
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-white md:static md:w-[380px] md:shrink-0 md:border-l md:border-gray-200"
      aria-label="Thread"
    >
      <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">Thread</h3>
          <p className="truncate text-xs text-gray-500">
            {channel.kind === 'dm' ? channel.name : `#${channel.name}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-gray-600 hover:bg-gray-100"
          aria-label="Close thread"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
        {isLoading && <p className="py-10 text-center text-sm text-gray-500">Loading thread…</p>}
        {isError && (
          <p className="py-10 text-center text-sm text-gray-600">
            Couldn&apos;t load this thread.{' '}
            <button type="button" className="font-semibold text-emerald-700 underline" onClick={() => refetch()}>
              Try again
            </button>
          </p>
        )}
        {data && (
          <>
            {item(data.root)}
            <div className="my-3 flex items-center gap-3 text-xs font-medium text-gray-500">
              <span className="h-px flex-1 bg-gray-200" />
              {replies.length ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : 'No replies yet'}
              <span className="h-px flex-1 bg-gray-200" />
            </div>
            {replies.map((m, i) => item(m, replies[i - 1]))}
            {data.nextAfter != null && (
              <p className="py-2 text-center text-xs text-gray-400">Showing the first {replies.length} replies.</p>
            )}
          </>
        )}
      </div>

      <Composer
        channelName={channel.kind === 'dm' ? channel.name : `#${channel.name}`}
        people={people.filter((p) => p.id !== meId)}
        canMentionTeams={channel.kind === 'space' && channel.audience !== 'members'}
        onSend={doSend}
        placeholder="Reply in thread"
      />
    </aside>
  );
}
