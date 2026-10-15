import { applyThreadUpdate, upsertMessage, upsertReply } from './useTeamChat';
import type { ChatMessage, MessagePage, ThreadData } from './useTeamChat';
import type { InfiniteData } from '@tanstack/react-query';

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1', channelId: 'c1', seq: 1, kind: 'user', text: 'hi', deleted: false,
  sender: { id: 'u1', name: 'Sam', role: 'staff', team: 'sales', teamLabel: 'Sales', isHead: false },
  clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-10-10T10:00:00Z', ...over,
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

  it('a confirmed message keeps its attachments and order references', () => {
    const pending = msg({ id: 'pending-k3', clientId: 'k3', seq: Number.MAX_SAFE_INTEGER, pending: true, text: 'photo' });
    const confirmed = msg({
      id: 'real3', clientId: 'k3', seq: 7, text: 'photo',
      attachments: [{ url: 'https://res.cloudinary.com/a.png', kind: 'image', name: 'a.png', mime: 'image/png', size: 10 }],
      refs: [{ type: 'order', code: '#AB12CD34', id: 'o1' }],
    });
    const out = upsertMessage(data([pending]), confirmed);
    expect(out!.pages[0].messages).toHaveLength(1);
    const merged = out!.pages[0].messages[0];
    expect(merged).toMatchObject({ id: 'real3', attachments: [expect.objectContaining({ name: 'a.png' })] });
    expect(merged.refs[0].code).toBe('#AB12CD34');
    expect(merged.pending).toBeUndefined(); // the optimistic copy is gone, not merged into
  });
});

describe('threads in the cache', () => {
  const texts = (d?: InfiniteData<MessagePage, number>) => d!.pages.flatMap((p) => p.messages.map((m) => m.text));

  it('a reply never lands in the timeline', () => {
    const d = data([msg({ id: 'a', seq: 1, activitySeq: 1, text: 'root' })]);
    expect(texts(upsertMessage(d, msg({ id: 'r', seq: 2, threadRoot: 'a', text: 'reply' })))).toEqual(['root']);
  });

  it('orders the timeline by thread activity', () => {
    const d = data([msg({ id: 'a', seq: 1, activitySeq: 5, text: 'busy thread' })]);
    expect(texts(upsertMessage(d, msg({ id: 'b', seq: 3, activitySeq: 3, text: 'quiet' })))).toEqual(['quiet', 'busy thread']);
  });

  it('a moved thread comes to the bottom, once, even from an older page', () => {
    const d: InfiniteData<MessagePage, number> = {
      pages: [
        { messages: [msg({ id: 'b', seq: 2, activitySeq: 2, text: 'b' }), msg({ id: 'c', seq: 3, activitySeq: 3, text: 'c' })], nextBefore: 2 },
        { messages: [msg({ id: 'a', seq: 1, activitySeq: 1, text: 'a' })], nextBefore: null },
      ],
      pageParams: [0, 2],
    };
    const moved = applyThreadUpdate(d, msg({ id: 'a', seq: 1, activitySeq: 4, replyCount: 1, text: 'a' }));
    expect(moved!.pages[0].messages.map((m) => m.text)).toEqual(['b', 'c', 'a']);
    expect(moved!.pages[1].messages).toHaveLength(0);
  });

  it('keeps a pending send below a thread that just moved', () => {
    const d = data([msg({ id: 'p', seq: Number.MAX_SAFE_INTEGER, pending: true, text: 'sending' })]);
    const moved = applyThreadUpdate(d, msg({ id: 'a', seq: 1, activitySeq: 9, text: 'a' }));
    expect(texts(moved)).toEqual(['a', 'sending']);
  });

  it('a reply replaces its pending copy in the thread, in seq order', () => {
    const t: ThreadData = {
      root: msg({ id: 'a' }),
      replies: [msg({ id: 'pending-x', clientId: 'x', pending: true, seq: Number.MAX_SAFE_INTEGER, text: 'mine' })],
      nextAfter: null,
    };
    const live = upsertReply(t, msg({ id: 'r1', seq: 4, threadRoot: 'a', text: 'theirs' }));
    const confirmed = upsertReply(live, msg({ id: 'r2', seq: 5, clientId: 'x', threadRoot: 'a', text: 'mine' }));
    expect(confirmed!.replies.map((m) => m.id)).toEqual(['r1', 'r2']);
    expect(upsertReply(undefined, msg({}))).toBeUndefined();
  });
});
