'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { reelKeys } from '@/hooks/queries/keys';
import { REEL_TABS, fetchAdminReels, type ReelStatus } from './api';
import ReelCard from './ReelCard';

/** One status tab at a time, keyset-paged by the server ("Load more"). */
export default function ReelsQueue() {
  const [status, setStatus] = useState<ReelStatus>('pending');
  const tab = REEL_TABS.find((t) => t.status === status) ?? REEL_TABS[0];

  const list = useInfiniteQuery({
    queryKey: reelKeys.adminList(status),
    initialPageParam: '',
    queryFn: ({ pageParam }) => fetchAdminReels(status, pageParam),
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const reels = list.data?.pages.flatMap((p) => p.reels) ?? [];

  return (
    <section className="space-y-4">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Reel status">
        {REEL_TABS.map((t) => (
          <button key={t.status} type="button" role="tab" aria-selected={t.status === status} onClick={() => setStatus(t.status)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${t.status === status ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {list.isPending && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading reels">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="aspect-[9/16] animate-pulse rounded-xl bg-gray-200" />
          ))}
        </ul>
      )}

      {list.isError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load the reels.{' '}
          <button type="button" onClick={() => list.refetch()} className="font-semibold underline">Try again</button>
        </div>
      )}

      {list.isSuccess && reels.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">{tab.empty}</p>
      )}

      {reels.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {reels.map((r) => <ReelCard key={r.id} reel={r} />)}
        </ul>
      )}

      {list.hasNextPage && (
        <div className="flex justify-center">
          <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      {list.isFetchNextPageError && <p role="alert" className="text-center text-sm text-red-700">Could not load more. Try again.</p>}
    </section>
  );
}
