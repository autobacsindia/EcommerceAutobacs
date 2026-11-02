'use client';

import { useEffect, useMemo } from 'react';
import { Loader2, MessagesSquare, X } from 'lucide-react';
import { useMyThreads } from '@/hooks/queries/useTeamChat';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';
import { Avatar, ChannelIcon, shortWhen } from './chatUi';

/**
 * "Threads": every thread I started or replied to, the one that moved last
 * first. A thread with replies I have not seen is bold with "N new". Opening
 * one goes to its conversation with the thread open (which marks it read).
 */
export default function ThreadsListPanel({
  channels,
  onPick,
  onClose,
}: {
  channels: ChatChannel[];
  onPick: (channelId: string, rootId: string) => void;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useMyThreads(true);
  const items = useMemo(() => data?.pages.flatMap((p) => p.threads) ?? [], [data]);
  const channelOf = (id: string) => channels.find((c) => c.id === id) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white" role="dialog" aria-label="Threads">
      <div className="flex items-center gap-2 border-b border-gray-200 p-3">
        <MessagesSquare className="h-5 w-5 text-blue-700" aria-hidden="true" />
        <h2 className="flex-1 text-base font-semibold text-gray-900">Threads</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label="Close threads">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading && (
          <p className="flex items-center gap-2 px-1 py-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        )}
        {isError && (
          <p className="px-1 py-6 text-sm text-gray-600">
            Couldn&apos;t load your threads.{' '}
            <button type="button" className="font-semibold text-blue-700 underline" onClick={() => refetch()}>Try again</button>
          </p>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="px-1 py-10 text-center">
            <p className="text-base font-semibold text-gray-800">No threads yet</p>
            <p className="mt-1 text-sm text-gray-500">When you reply in a thread, or someone replies to your message, it shows up here.</p>
          </div>
        )}
        {items.length > 0 && (
          <ul className="space-y-1">
            {items.map((t) => {
              const channel = channelOf(t.channel);
              const unread = t.unread > 0;
              const root = t.root;
              return (
                <li key={root.id}>
                  <button
                    type="button"
                    onClick={() => onPick(t.channel, root.id)}
                    className="w-full rounded-lg border border-transparent px-2 py-2 text-left hover:border-gray-200 hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                      {channel ? <ChannelIcon channel={channel} /> : null}
                      <span className="min-w-0 flex-1 truncate">{t.channelName}</span>
                      <span className="shrink-0 font-normal text-gray-400">{shortWhen(t.lastActivityAt)}</span>
                    </span>
                    <span className="mt-1.5 flex items-start gap-2">
                      <Avatar person={root.sender} system={root.kind === 'system'} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className={`line-clamp-2 block break-words text-sm ${unread ? 'font-bold text-gray-900' : 'text-gray-800'} ${root.deleted ? 'italic text-gray-400' : ''}`}>
                          {root.deleted ? 'Message deleted' : root.text || (root.attachments.length ? '📎 Shared a file' : '')}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                          <span>{root.replyCount ?? 0} {root.replyCount === 1 ? 'reply' : 'replies'}</span>
                          {root.lastReply?.by && <span className="min-w-0 truncate">· last from {root.lastReply.by}</span>}
                          {unread && (
                            <span className="ml-auto shrink-0 rounded-full bg-blue-600 px-2 text-[11px] font-bold leading-[18px] text-white">
                              {t.unread > 99 ? '99+' : t.unread} new
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {hasNextPage && (
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="mt-3 h-10 w-full rounded-full bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isFetchingNextPage ? 'Loading…' : 'Show older'}
          </button>
        )}
      </div>
    </div>
  );
}
