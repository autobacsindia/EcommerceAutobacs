/**
 * Follow + Save for reels — UI ONLY, kept in memory on this phone for this app
 * session. The reels API has no follow or bookmark endpoint yet, so nothing is
 * sent to the server and nothing here survives an app restart. When the API
 * grows those endpoints, swap the bodies of `toggle*` for the API calls; the
 * hooks keep the same shape.
 */
import { useSyncExternalStore } from 'react';

const followed = new Set<string>();
const saved = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => version;

/** Returns the new state. */
export function toggleFollow(creatorId: string): boolean {
  const on = !followed.has(creatorId);
  if (on) followed.add(creatorId);
  else followed.delete(creatorId);
  emit();
  return on;
}

/** Returns the new state. */
export function toggleSave(reelId: string): boolean {
  const on = !saved.has(reelId);
  if (on) saved.add(reelId);
  else saved.delete(reelId);
  emit();
  return on;
}

export function useFollowing(creatorId: string | null): boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return creatorId != null && followed.has(creatorId);
}

export function useSaved(reelId: string): boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return saved.has(reelId);
}
