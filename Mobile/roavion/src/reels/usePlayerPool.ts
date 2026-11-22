/**
 * Three recycled video players for the whole feed.
 *
 * Reel i always uses player slot `i % 3`, so the visible reel and its two
 * neighbours each have a loaded player (the next one is PRELOADED before the
 * swipe) and memory stays flat however far someone scrolls: a reel scrolled
 * past simply hands its player to the reel three places further on.
 *
 * Only the active slot plays; the others are paused. Mute is shared.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';
import type { Reel } from '../api/reels';

export const POOL_SIZE = 3;

export interface SlotState {
  /** Reel id loaded into this slot, or null. */
  reelId: string | null;
  /** True once the slot's current video can play (hide the poster). */
  ready: boolean;
  playing: boolean;
  error: boolean;
}

const EMPTY: SlotState = { reelId: null, ready: false, playing: false, error: false };

export function sourceOf(reel: Reel): VideoSource {
  // HLS adapts to the connection; MP4 is the universal fallback.
  const uri = reel.hlsUrl || reel.mp4Url;
  return uri ? { uri, useCaching: !reel.hlsUrl } : null;
}

const setup = (p: VideoPlayer) => {
  p.loop = true;
  p.muted = false;
  p.timeUpdateEventInterval = 0.25;
};

export function usePlayerPool() {
  const p0 = useVideoPlayer(null, setup);
  const p1 = useVideoPlayer(null, setup);
  const p2 = useVideoPlayer(null, setup);
  const players = useMemo(() => [p0, p1, p2], [p0, p1, p2]);

  const [slots, setSlots] = useState<SlotState[]>([EMPTY, EMPTY, EMPTY]);
  const loaded = useRef<(string | null)[]>([null, null, null]);

  const patch = useCallback((slot: number, next: Partial<SlotState>) => {
    setSlots((prev) => {
      const cur = prev[slot];
      if (Object.entries(next).every(([k, v]) => cur[k as keyof SlotState] === v)) return prev;
      const copy = prev.slice();
      copy[slot] = { ...cur, ...next };
      return copy;
    });
  }, []);

  // Native status → React state, per slot.
  useEffect(() => {
    const subs = players.flatMap((p, slot) => [
      p.addListener('statusChange', ({ status }) => {
        if (status === 'readyToPlay') patch(slot, { ready: true, error: false });
        else if (status === 'error') patch(slot, { error: true });
      }),
      // Playing implies ready — covers a readyToPlay event that fired before we listened.
      p.addListener('playingChange', ({ isPlaying }) =>
        patch(slot, isPlaying ? { playing: true, ready: true, error: false } : { playing: false }),
      ),
    ]);
    return () => subs.forEach((s) => s.remove());
  }, [players, patch]);

  /** Make sure `reel` is loaded in its slot. Returns true if it was (re)loaded. */
  const load = useCallback(
    (index: number, reel: Reel): boolean => {
      const slot = index % POOL_SIZE;
      if (loaded.current[slot] === reel.id) return false;
      loaded.current[slot] = reel.id;
      const p = players[slot];
      p.pause();
      patch(slot, { reelId: reel.id, ready: false, playing: false, error: false });
      p.replaceAsync(sourceOf(reel))
        .then(() => {
          if (loaded.current[slot] === reel.id && p.status === 'readyToPlay') patch(slot, { ready: true });
        })
        .catch(() => patch(slot, { error: true }));
      return true;
    },
    [players, patch],
  );

  /** Retry a slot whose video failed (e.g. network dropped). */
  const reload = useCallback(
    (index: number, reel: Reel) => {
      loaded.current[index % POOL_SIZE] = null;
      load(index, reel);
    },
    [load],
  );

  /** Rewind a reel's player to the start (when it becomes the active reel). */
  const restart = useCallback(
    (index: number) => {
      try {
        const p = players[index % POOL_SIZE];
        if (p.currentTime > 0) p.seekBy(-p.currentTime);
      } catch {
        /* not loaded yet — it starts at 0 anyway */
      }
    },
    [players],
  );

  const setMuted = useCallback((muted: boolean) => players.forEach((p) => (p.muted = muted)), [players]);

  const pauseAll = useCallback(() => players.forEach((p) => p.pause()), [players]);

  return { players, slots, load, reload, restart, setMuted, pauseAll };
}
