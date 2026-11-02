import { useEffect, useSyncExternalStore } from 'react';

/**
 * "Ravi is typing…" — who is typing where, from the chat stream's `typing`
 * events. A module store (not React Query): it is a few seconds of passing
 * state, never fetched, and every conversation and thread panel reads it.
 *
 * Each event keeps a name on screen for TYPING_SHOW_MS; senders repeat every
 * few seconds while they type (the server throttles to one per 3 s), so the
 * line stays up while they type and goes away on its own when they stop or
 * close the tab. A message from that person clears it at once.
 */
export const TYPING_SHOW_MS = 6000;
/** How often the composer may send "I am typing" (matches the server throttle). */
export const TYPING_SEND_EVERY_MS = 3000;

type Entry = { name: string; until: number };
const where = (channelId: string, threadRoot: string | null) => `${channelId}|${threadRoot ?? ''}`;
const store = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  listeners.forEach((l) => l());
}

export function noteTyping(
  { channelId, threadRoot, userId, name }: { channelId: string; threadRoot?: string | null; userId: string; name: string },
  now = Date.now(),
) {
  const k = where(channelId, threadRoot ?? null);
  const people = store.get(k) ?? new Map<string, Entry>();
  people.set(userId, { name, until: now + TYPING_SHOW_MS });
  store.set(k, people);
  changed();
  // Redraw when it lapses, so the line goes without waiting for another event.
  setTimeout(changed, TYPING_SHOW_MS + 50);
}

/** Their message arrived: they are no longer typing, anywhere in that conversation. */
export function clearTyping(channelId: string, userId: string) {
  let any = false;
  for (const [k, people] of store) {
    if (k.startsWith(`${channelId}|`) && people.delete(userId)) any = true;
  }
  if (any) changed();
}

/** Names typing here right now, oldest first. */
export function typingNames(channelId: string, threadRoot: string | null, now = Date.now()): string[] {
  const people = store.get(where(channelId, threadRoot));
  if (!people) return [];
  for (const [id, e] of people) if (e.until <= now) people.delete(id);
  return [...people.values()].map((e) => e.name || 'Someone');
}

/** "Ravi is typing…", "Ravi and Anu are typing…", "Several people are typing…", or ''. */
export function typingLine(names: string[]): string {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useTypingLine(channelId: string, threadRoot: string | null): string {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return typingLine(typingNames(channelId, threadRoot));
}

/** Test helper: forget everything. */
export function resetTyping() {
  store.clear();
  changed();
}

/** Stop showing anyone when the component that owns the stream goes away. */
export function useResetTypingOnUnmount() {
  useEffect(() => () => resetTyping(), []);
}
