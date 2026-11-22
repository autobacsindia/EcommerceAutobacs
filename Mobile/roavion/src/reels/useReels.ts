/**
 * React Query wiring for reels: the cursor-paginated feed, the creator's own
 * reels, and likes.
 *
 * Likes are optimistic (cheap and reversible, like a wishlist) and roll back if
 * the server refuses. Nothing about money is optimistic here.
 */
import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { fetchMyReels, fetchReels, likeReel, type Reel, type ReelPage } from '../api/reels';

export const reelKeys = {
  feed: ['reels', 'feed'] as const,
  mine: ['reels', 'mine'] as const,
};

export function useReelFeed() {
  const q = useInfiniteQuery({
    queryKey: reelKeys.feed,
    queryFn: ({ pageParam, signal }) => fetchReels(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ReelPage) => last.nextCursor ?? undefined,
    staleTime: 2 * 60_000,
  });

  // Flatten and de-duplicate: a reel can shift pages between fetches.
  const reels = useMemo(() => {
    const seen = new Set<string>();
    const out: Reel[] = [];
    for (const page of q.data?.pages ?? []) {
      for (const r of page.reels) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    }
    return out;
  }, [q.data]);

  return { ...q, reels };
}

export function useMyReels(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: reelKeys.mine,
    queryFn: ({ pageParam, signal }) => fetchMyReels(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ReelPage) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 0,
  });
}

/** Toggle (or force on) a like, optimistically, rolling back on failure. */
export function useLikeReel() {
  const qc = useQueryClient();

  const patch = useCallback(
    (id: string, liked: boolean, exactCount?: number) => {
      qc.setQueryData<InfiniteData<ReelPage>>(reelKeys.feed, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                reels: p.reels.map((r) =>
                  r.id !== id
                    ? r
                    : exactCount != null
                      ? { ...r, viewerLiked: liked, likeCount: exactCount }
                      : r.viewerLiked !== liked
                        ? { ...r, viewerLiked: liked, likeCount: Math.max(0, r.likeCount + (liked ? 1 : -1)) }
                        : r,
                ),
              })),
            }
          : data,
      );
    },
    [qc],
  );

  return useCallback(
    async (reel: Reel, liked: boolean) => {
      if (reel.viewerLiked === liked) return;
      patch(reel.id, liked);
      try {
        const res = await likeReel(reel.id, liked);
        // Reconcile with the server's authoritative state and count.
        if (typeof res?.likeCount === 'number') patch(reel.id, res.liked ?? liked, res.likeCount);
      } catch (err) {
        patch(reel.id, !liked);
        throw err;
      }
    },
    [patch],
  );
}
