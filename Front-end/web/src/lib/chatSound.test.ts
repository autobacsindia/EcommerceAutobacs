/** The chat-sound rules (lib/chatSound.ts): what counts, once per message, the cool-down, one tab for the work alert. */
import { COOLDOWN_MS, claimAlertNow, claimChime, claimChimeNow, soundWorthy } from './chatSound';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';

const ch = (id: string, over: Partial<ChatChannel> = {}) => ({
  id, kind: 'space', name: id, unread: 0, unreadChat: 0, unreadUpdates: 0, lastMessageAt: null, ...over,
}) as unknown as ChatChannel;
const T = Date.parse('2026-10-29T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => localStorage.clear());

describe('what may ring', () => {
  const channels = [
    ch('a', { unread: 2, unreadChat: 2, lastMessageAt: iso(T + 1000) }),
    ch('b', { unreadUpdates: 3, lastMessageAt: iso(T + 5000) }),
    ch('c', { unread: 1, unreadChat: 1, notify: 'off', lastMessageAt: iso(T + 9000) }),
    ch('d', { unread: 4, unreadChat: 4, unreadMentions: 1, notify: 'mentions', lastMessageAt: iso(T + 2000) }),
  ];

  it('people\'s messages count; order updates do not unless chosen; muted spaces never; @mentions-only counts mentions', () => {
    expect(soundWorthy({ channels, openId: null, updatesSound: false })).toEqual({ count: 3, newestAt: T + 2000 });
    expect(soundWorthy({ channels, openId: null, updatesSound: true })).toEqual({ count: 6, newestAt: T + 5000 });
  });

  it('leaves out the conversation on screen', () => {
    expect(soundWorthy({ channels, openId: 'a', updatesSound: false })).toEqual({ count: 1, newestAt: T + 2000 });
  });
});

describe('once per message, with a cool-down', () => {
  it('a message rings once, whichever tab asks first', () => {
    expect(claimChimeNow(T + 1000, T + 2000)).toBe(true);
    expect(claimChimeNow(T + 1000, T + 60000)).toBe(false); // another tab, same message
  });

  it('a newer message within the cool-down is quiet; after it, it rings', () => {
    expect(claimChimeNow(T + 1000, T + 2000)).toBe(true);
    expect(claimChimeNow(T + 3000, T + 2000 + COOLDOWN_MS - 1)).toBe(false);
    expect(claimChimeNow(T + 4000, T + 2000 + COOLDOWN_MS)).toBe(true);
  });

  it('an old message reappearing (a stale refresh) never rings again', () => {
    expect(claimChimeNow(T + 5000, T + 6000)).toBe(true);
    expect(claimChimeNow(T + 4000, T + 100000)).toBe(false);
  });

  it('nothing to ring for: no', () => {
    expect(claimChimeNow(0)).toBe(false);
  });

  it('two tabs asking at the same moment through the lock: one rings', async () => {
    const queue: Array<() => unknown> = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: (_: string, fn: () => unknown) => new Promise((r) => { queue.push(() => r(fn())); if (queue.length === 1) queue.shift()!(); }) },
    });
    try {
      const a = claimChime(T + 1000);
      const b = new Promise((r) => setTimeout(() => { queue.shift()?.(); r(null); }, 0)).then(() => claimChime(T + 1000));
      expect([await a, await b].filter(Boolean)).toHaveLength(1);
    } finally {
      delete (navigator as unknown as { locks?: unknown }).locks;
    }
  });
});

describe('the work alert: one tab', () => {
  it('rings once for a rise, again when work rises further, again after a minute', () => {
    expect(claimAlertNow(3, T)).toBe(true);
    expect(claimAlertNow(3, T + 5000)).toBe(false); // the other tab, same rise
    expect(claimAlertNow(4, T + 6000)).toBe(true);
    expect(claimAlertNow(4, T + 6000 + 60000)).toBe(true);
  });
});
