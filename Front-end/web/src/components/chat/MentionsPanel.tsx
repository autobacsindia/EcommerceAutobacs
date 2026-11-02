'use client';

import { useEffect, useMemo } from 'react';
import { AtSign, Loader2, X } from 'lucide-react';
import { useMentions } from '@/hooks/queries/useTeamChat';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';
import { Avatar, ChannelIcon, dayLabel, timeOf } from './chatUi';

/**
 * Every message that @mentions me, my team, or @all, newest first, from the
 * conversations I can read. Opening one goes to its conversation — and to its
 * thread when it was a reply.
 */
export default function MentionsPanel({
  channels,
  onPick,
  onClose,
}: {
  channels: ChatChannel[];
  onPick: (channelId: string, threadRoot: string | null) => void;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useMentions(true);
  const items = useMemo(() => data?.pages.flatMap((p) => p.messages) ?? [], [data]);
  const channelOf = (id: string) => channels.find((c) => c.id === id) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white" role="dialog" aria-label="Mentions">
      <div className="flex items-center gap-2 border-b border-gray-200 p-3">
        <AtSign className="h-5 w-5 text-blue-700" aria-hidden="true" />
        <h2 className="flex-1 text-base font-semibold text-gray-900">Mentions</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label="Close mentions">
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
            Couldn&apos;t load your mentions.{' '}
            <button type="button" className="font-semibold text-blue-700 underline" onClick={() => refetch()}>Try again</button>
          </p>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="px-1 py-10 text-center">
            <p className="text-base font-semibold text-gray-800">No mentions yet</p>
            <p className="mt-1 text-sm text-gray-500">When someone writes @ and your name, your team, or @all, it shows up here.</p>
          </div>
        )}
        {items.length > 0 && (
          <ul className="space-y-1">
            {items.map((m) => {
              const channel = channelOf(m.channel);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onPick(m.channel, m.threadRoot ?? null)}
                    className="w-full rounded-lg border border-transparent px-2 py-2 text-left hover:border-gray-200 hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                      {channel ? <ChannelIcon channel={channel} /> : null}
                      <span className="truncate">{m.channelName}</span>
                      {m.threadRoot && <span className="font-normal text-gray-400">· in a thread</span>}
                      <span className="font-normal text-gray-400">· {dayLabel(m.createdAt)} at {timeOf(m.createdAt)}</span>
                    </span>
                    <span className="mt-1.5 flex items-start gap-2">
                      <Avatar person={m.sender} system={m.kind === 'system'} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">
                          {m.kind === 'system' ? 'Roavion' : m.sender?.name ?? 'Someone'}
                        </span>
                        <span className="mt-0.5 line-clamp-4 block whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">
                          {m.text || (m.attachments.length ? '📎 Shared a file' : '')}
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
