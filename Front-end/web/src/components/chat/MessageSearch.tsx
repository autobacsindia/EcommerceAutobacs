'use client';

/**
 * Search message text across every space and DM the signed-in person can see.
 *
 * ── Why this is a panel and not the sidebar box ──────────────────────────────
 * The sidebar box filters the channel list — a local, instant narrowing of
 * names. This searches the history on the server and returns messages from many
 * channels at once, so the result needs room: who said it, which channel, and
 * when. Overloading one input with both behaviours would make it unclear what
 * typing is about to do.
 *
 * ── What a result links to ──────────────────────────────────────────────────
 * Clicking a hit opens the channel it was found in, at the bottom, rather than
 * scrolled to that exact message. Jumping to a message means loading the pages
 * between it and the newest one, and the honest version of that is a separate
 * piece of work; a channel that opens reliably is better than a jump that
 * sometimes lands in the wrong place. The matched text is shown in full here,
 * so the panel usually answers the question without the jump.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useChatSearch } from '@/hooks/queries/useTeamChat';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';
import { Avatar, ChannelIcon, dayLabel, timeOf, GREEN } from './chatUi';

/** Long enough that a fast typist sends one request per word, not per letter. */
const DEBOUNCE_MS = 300;

export default function MessageSearch({
  channels,
  scopeTo,
  onPick,
  onClose,
}: {
  channels: ChatChannel[];
  /** When set, search only this channel — "search in this conversation". */
  scopeTo?: ChatChannel | null;
  onPick: (channelId: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [term, setTerm] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const t = setTimeout(() => setTerm(typed), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [typed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const {
    data,
    isFetching,
    isError,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useChatSearch(term, scopeTo?.id ?? null);

  const hits = useMemo(() => data?.pages.flatMap((p) => p.messages) ?? [], [data]);
  const asked = term.trim().length >= 2;
  // A channel the search names but the list has not loaded yet still shows its
  // name from the server; the icon simply falls back to a plain hash.
  const channelOf = (id: string) => channels.find((c) => c.id === id) ?? null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-gray-200 p-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={scopeTo ? `Search in ${scopeTo.name}` : 'Search all messages'}
            aria-label={scopeTo ? `Search in ${scopeTo.name}` : 'Search all messages'}
            className="h-10 w-full rounded-lg border border-gray-300 pl-8 pr-3 text-sm outline-none focus:border-emerald-600"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
          aria-label="Close search"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!asked && (
          <p className="px-1 py-6 text-sm text-gray-500">
            Type at least two letters. You&apos;ll only see messages from spaces and
            conversations you&apos;re already part of.
          </p>
        )}

        {asked && isError && (
          <p className="px-1 py-6 text-sm text-gray-600">
            {/* The server has a plain-English reason in the window right after a
                deploy, before the search index is built — worth showing. */}
            {error instanceof Error && error.message ? error.message : "Couldn't run the search."}{' '}
            <button type="button" className="font-semibold text-emerald-700 underline" onClick={() => refetch()}>
              Try again
            </button>
          </p>
        )}

        {asked && !isError && isFetching && hits.length === 0 && (
          <p className="flex items-center gap-2 px-1 py-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching…
          </p>
        )}

        {asked && !isError && !isFetching && hits.length === 0 && (
          <p className="px-1 py-6 text-sm text-gray-500">
            Nothing matched <span className="font-medium text-gray-700">{term.trim()}</span>.
          </p>
        )}

        {hits.length > 0 && (
          <ul className="space-y-1">
            {hits.map((m) => {
              const channel = channelOf(m.channel);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onPick(m.channel)}
                    className="w-full rounded-lg border border-transparent px-2 py-2 text-left hover:border-gray-200 hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                      {channel ? <ChannelIcon channel={channel} /> : null}
                      <span className="truncate">{m.channelName}</span>
                      <span className="font-normal text-gray-400">
                        · {dayLabel(m.createdAt)} at {timeOf(m.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-start gap-2">
                      <Avatar person={m.sender} system={m.kind === 'system'} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">
                          {m.kind === 'system' ? 'Roavion' : m.sender?.name ?? 'Someone'}
                        </span>
                        <span className="mt-0.5 block whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">
                          {m.text}
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
            className="mt-3 h-10 w-full rounded-full text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: GREEN }}
          >
            {isFetchingNextPage ? 'Loading…' : 'Show older matches'}
          </button>
        )}
      </div>
    </div>
  );
}
