import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { ChatStreamProvider, useChatStream } from './useChatStream';

/*
 * One /chat/stream per tab. Calls (in every panel page) and the Chat page used to
 * open one each, so a tab on Chat held two long-lived connections for the same
 * events. They now share the one the panel layout opens.
 */

jest.mock('@/hooks/queries/useTeamChat', () => ({ useCanChat: () => true }));

if (!(global as { TextDecoder?: unknown }).TextDecoder) (global as { TextDecoder?: unknown }).TextDecoder = NodeTextDecoder;
const enc = new NodeTextEncoder();

type Stream = { push: (s: string) => void };

function fakeFetch() {
  const streams: Stream[] = [];
  const fn = jest.fn((_url: string, init?: RequestInit) => {
    const queue: Array<{ done: boolean; value?: Uint8Array }> = [];
    let waiter: ((v: { done: boolean; value?: Uint8Array }) => void) | null = null;
    let rejecter: ((e: Error) => void) | null = null;
    const deliver = (v: { done: boolean; value?: Uint8Array }) => {
      if (waiter) { const w = waiter; waiter = null; rejecter = null; w(v); } else queue.push(v);
    };
    init?.signal?.addEventListener('abort', () => {
      if (rejecter) { const r = rejecter; waiter = null; rejecter = null; r(Object.assign(new Error('aborted'), { name: 'AbortError' })); }
    });
    streams.push({ push: (s) => deliver({ done: false, value: enc.encode(s) }) });
    return Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((res, rej) => { waiter = res; rejecter = rej; })),
        }),
      },
    } as unknown as Response);
  });
  return { fn, streams };
}

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const streamCalls = (fn: jest.Mock) => fn.mock.calls.filter(([u]) => String(u).includes('/chat/stream')).length;

describe('useChatStream', () => {
  let ff: ReturnType<typeof fakeFetch>;
  beforeEach(() => {
    ff = fakeFetch();
    global.fetch = ff.fn as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const wrapper = ({ children }: { children: ReactNode }) => <ChatStreamProvider>{children}</ChatStreamProvider>;

  it('two listeners in one panel share ONE stream and both get every event', async () => {
    const calls = { onMessage: jest.fn(), onConnect: jest.fn() };
    const chat = { onMessage: jest.fn(), onConnect: jest.fn() };
    renderHook(() => {
      useChatStream({ enabled: true, ...calls });
      useChatStream({ enabled: true, ...chat });
    }, { wrapper });
    await act(flush);

    expect(streamCalls(ff.fn)).toBe(1);
    expect(calls.onConnect).toHaveBeenCalledTimes(1);
    expect(chat.onConnect).toHaveBeenCalledTimes(1);

    await act(async () => { ff.streams[0].push('data: {"type":"message","channelId":"c1"}\n\n'); await flush(); });
    expect(calls.onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'message', channelId: 'c1' }));
    expect(chat.onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'message', channelId: 'c1' }));
  });

  it('a listener that joins later (opening Chat) re-syncs once and opens no new stream', async () => {
    const early = { onMessage: jest.fn(), onConnect: jest.fn() };
    const late = { onMessage: jest.fn(), onConnect: jest.fn() };
    const { rerender } = renderHook(({ join }: { join: boolean }) => {
      useChatStream({ enabled: true, ...early });
      useChatStream({ enabled: join, ...late });
    }, { wrapper, initialProps: { join: false } });
    await act(flush);
    expect(late.onConnect).not.toHaveBeenCalled();

    rerender({ join: true });
    await act(flush);
    expect(late.onConnect).toHaveBeenCalledTimes(1);
    expect(streamCalls(ff.fn)).toBe(1);
  });

  it('a disabled listener hears nothing; leaving stops delivery', async () => {
    const off = { onMessage: jest.fn() };
    const on = { onMessage: jest.fn() };
    const { rerender } = renderHook(({ leave }: { leave: boolean }) => {
      useChatStream({ enabled: false, ...off });
      useChatStream({ enabled: !leave, ...on });
    }, { wrapper, initialProps: { leave: false } });
    await act(flush);
    await act(async () => { ff.streams[0].push('data: {"type":"a"}\n\n'); await flush(); });
    expect(off.onMessage).not.toHaveBeenCalled();
    expect(on.onMessage).toHaveBeenCalledTimes(1);

    rerender({ leave: true });
    await act(async () => { ff.streams[0].push('data: {"type":"b"}\n\n'); await flush(); });
    expect(on.onMessage).toHaveBeenCalledTimes(1);
  });

  it('outside a panel provider it still opens its own stream', async () => {
    const l = { onMessage: jest.fn(), onConnect: jest.fn() };
    renderHook(() => useChatStream({ enabled: true, ...l }));
    await act(flush);
    expect(streamCalls(ff.fn)).toBe(1);
    expect(l.onConnect).toHaveBeenCalledTimes(1);
  });
});
