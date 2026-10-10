import { upsertMessage } from './useTeamChat';
import type { ChatMessage, MessagePage } from './useTeamChat';
import type { InfiniteData } from '@tanstack/react-query';

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1', channelId: 'c1', seq: 1, kind: 'user', text: 'hi', deleted: false,
  sender: { id: 'u1', name: 'Sam', role: 'staff', team: 'sales', teamLabel: 'Sales', isHead: false },
  clientId: null, createdAt: '2026-10-10T10:00:00Z', ...over,
});

const data = (messages: ChatMessage[]): InfiniteData<MessagePage, number> => ({
  pages: [{ messages, nextBefore: null }],
  pageParams: [0],
});

describe('upsertMessage (live chat cache merge)', () => {
  it('appends a new message in seq order', () => {
    const out = upsertMessage(data([msg({ id: 'a', seq: 1 }), msg({ id: 'c', seq: 3 })]), msg({ id: 'b', seq: 2 }));
    expect(out!.pages[0].messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('the same message arriving twice (send response + live event) is kept once', () => {
    const once = upsertMessage(data([]), msg({ id: 'x', seq: 5 }));
    const twice = upsertMessage(once, msg({ id: 'x', seq: 5 }));
    expect(twice!.pages[0].messages).toHaveLength(1);
  });

  it('replaces the pending copy with the confirmed message by clientId', () => {
    const pending = msg({ id: 'pending-k1', clientId: 'k1', seq: Number.MAX_SAFE_INTEGER, pending: true });
    const out = upsertMessage(data([msg({ id: 'a', seq: 1 }), pending]), msg({ id: 'real', clientId: 'k1', seq: 2 }));
    expect(out!.pages[0].messages.map((m) => m.id)).toEqual(['a', 'real']);
  });

  it('keeps pending messages at the bottom', () => {
    const pending = msg({ id: 'pending-k2', clientId: 'k2', seq: Number.MAX_SAFE_INTEGER, pending: true });
    const out = upsertMessage(data([pending]), msg({ id: 'late', seq: 9 }));
    expect(out!.pages[0].messages.map((m) => m.id)).toEqual(['late', 'pending-k2']);
  });

  it('does nothing when the channel was never opened (no cache)', () => {
    expect(upsertMessage(undefined, msg({}))).toBeUndefined();
  });
});
