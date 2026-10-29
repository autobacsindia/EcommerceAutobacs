'use client';

import { useEffect, useMemo } from 'react';
import { Loader2, Star, StarOff, X } from 'lucide-react';
import { useStarMessage, useStarred } from '@/hooks/queries/useTeamChat';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';
import { Avatar, ChannelIcon, GREEN, dayLabel, timeOf } from './chatUi';

/**
 * My starred messages, newest star first — the "come back to this" list.
 * Opening one goes to its conversation. Private: only I see my stars.
 */
export default function StarredPanel({
  channels,
  onPick,
  onClose,
}: {
  channels: ChatChannel[];
  onPick: (channelId: string) => void;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useStarred(true);
  const unstar = useStarMessage();
  const items = useMemo(() => data?.pages.flatMap((p) => p.messages) ?? [], [data]);
  const channelOf = (id: string) => channels.find((c) => c.id === id) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white" role="dialog" aria-label="Starred messages">
      <div className="flex items-center gap-2 border-b border-gray-200 p-3">
        <Star className="h-5 w-5 fill-amber-400 text-amber-500" aria-hidden="true" />
        <h2 className="flex-1 text-base font-semibold text-gray-900">Starred</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label="Close starred">
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
            Couldn&apos;t load your starred messages.{' '}
            <button type="button" className="font-semibold text-emerald-700 underline" onClick={() => refetch()}>Try again</button>
          </p>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="px-1 py-10 text-center">
            <p className="text-base font-semibold text-gray-800">Nothing starred yet</p>
            <p className="mt-1 text-sm text-gray-500">Open ⋮ on any message and choose Star to keep it here.</p>
          </div>
        )}
        {items.length > 0 && (
          <ul className="space-y-1">
            {items.map((m) => {
              const channel = channelOf(m.channel);
              return (
                <li key={m.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onPick(m.channel)}
                    className="w-full rounded-lg border border-transparent px-2 py-2 pr-10 text-left hover:border-gray-200 hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                      {channel ? <ChannelIcon channel={channel} /> : null}
                      <span className="truncate">{m.channelName}</span>
                      <span className="font-normal text-gray-400">· {dayLabel(m.createdAt)} at {timeOf(m.createdAt)}</span>
                    </span>
                    <span className="mt-1.5 flex items-start gap-2">
                      <Avatar person={m.sender} system={m.kind === 'system'} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">
                          {m.kind === 'system' ? 'Roavion' : m.sender?.name ?? 'Someone'}
                        </span>
                        <span className={`mt-0.5 line-clamp-4 block whitespace-pre-wrap break-words text-sm leading-relaxed ${m.deleted ? 'italic text-gray-400' : 'text-gray-700'}`}>
                          {m.deleted ? `Deleted: ${m.text}` : m.text || (m.attachments.length ? '📎 Shared a file' : '')}
                        </span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => unstar.mutate({ id: m.id, on: false })}
                    className="absolute right-2 top-2 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Remove star"
                    title="Remove star"
                  >
                    <StarOff className="h-4 w-4" />
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
            className="mt-3 h-10 w-full rounded-full text-sm font-semibold text-[#fff] disabled:opacity-50"
            style={{ background: GREEN }}
          >
            {isFetchingNextPage ? 'Loading…' : 'Show older'}
          </button>
        )}
      </div>
    </div>
  );
}
