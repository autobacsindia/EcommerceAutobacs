import { renderHook, act } from '@testing-library/react';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { useSSE, backoffDelay, STALE_AFTER_MS, SLOW_RETRY_MS, MAX_FAST_DELAY_MS } from './useSSE';

/*
 * The live stream feeds chat, the bell and calls. A page that stops listening
 * is silent for good, so every way a stream can end must lead back to a
 * connected stream: a clean close, a network error, a half-open connection, and
 * a long outage (it used to give up after 10 tries).
 */

if (!(global as { TextDecoder?: unknown }).TextDecoder) (global as { TextDecoder?: unknown }).TextDecoder = NodeTextDecoder;
const enc = new NodeTextEncoder();

type Stream = { push: (s: string) => void; end: () => void; fail: (e: Error) => void };

/** A fake fetch whose responses we drive by hand. */
function fakeFetch() {
  const streams: Stream[] = [];
  const fn = jest.fn((_url: string, init?: RequestInit) => {
    const queue: Array<{ done: boolean; value?: Uint8Array }> = [];
    let waiter: ((v: { done: boolean; value?: Uint8Array }) => void) | null = null;
    let rejecter: ((e: Error) => void) | null = null;
    const deliver = (v: { done: boolean; value?: Uint8Array }) => {
      if (waiter) { const w = waiter; waiter = null; rejecter = null; w(v); } else queue.push(v);
    };
    const fail = (e: Error) => { if (rejecter) { const r = rejecter; waiter = null; rejecter = null; r(e); } };
    init?.signal?.addEventListener('abort', () => fail(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    streams.push({ push: (s) => deliver({ done: false, value: enc.encode(s) }), end: () => deliver({ done: true }), fail });
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

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

describe('backoffDelay', () => {
  it('backs off fast, caps, then keeps trying slowly — never gives up', () => {
    expect(backoffDelay(0, 1000, 10)).toBe(1000);
    expect(backoffDelay(3, 1000, 10)).toBe(8000);
    expect(backoffDelay(9, 1000, 10)).toBe(MAX_FAST_DELAY_MS);
    expect(backoffDelay(10, 1000, 10)).toBe(SLOW_RETRY_MS);
    expect(backoffDelay(500, 1000, 10)).toBe(SLOW_RETRY_MS);
  });
});

describe('useSSE reconnect path', () => {
  let ff: ReturnType<typeof fakeFetch>;
  beforeEach(() => {
    jest.useFakeTimers();
    ff = fakeFetch();
    global.fetch = ff.fn as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const mount = (extra: Partial<Parameters<typeof useSSE>[0]> = {}) => {
    const onMessage = jest.fn();
    const onConnect = jest.fn();
    const hook = renderHook(() => useSSE({ url: '/api/v1/chat/stream', token: null, onMessage, onConnect, ...extra }));
    return { onMessage, onConnect, hook };
  };

  it('delivers events and reconnects after the server closes the stream cleanly', async () => {
    const { onMessage, onConnect } = mount();
    await act(flush);
    expect(ff.fn).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledTimes(1);

    await act(async () => { ff.streams[0].push('data: {"type":"message"}\n\n'); await flush(); });
    expect(onMessage).toHaveBeenCalledWith({ type: 'message' });

    // Deploy / proxy limit: a clean end. It used to stop listening here for good.
    await act(async () => { ff.streams[0].end(); await flush(); });
    await act(async () => { jest.advanceTimersByTime(1000); await flush(); });
    expect(ff.fn).toHaveBeenCalledTimes(2);
    expect(onConnect).toHaveBeenCalledTimes(2); // consumers re-sync what they missed
  });

  it('treats a silent (half-open) stream as dead and reconnects', async () => {
    mount();
    await act(flush);
    await act(async () => { jest.advanceTimersByTime(STALE_AFTER_MS - 1000); await flush(); });
    await act(async () => { ff.streams[0].push('data: {"type":"heartbeat"}\n\n'); await flush(); });
    // A heartbeat re-arms the watchdog: still the first connection.
    await act(async () => { jest.advanceTimersByTime(STALE_AFTER_MS - 1000); await flush(); });
    expect(ff.fn).toHaveBeenCalledTimes(1);
    // Then nothing at all for STALE_AFTER_MS.
    await act(async () => { jest.advanceTimersByTime(1000); await flush(); });
    await act(async () => { jest.advanceTimersByTime(1000); await flush(); });
    expect(ff.fn).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying through a long outage instead of giving up after 10 tries', async () => {
    ff.fn.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    mount({ maxReconnectAttempts: 3 });
    await act(flush);
    for (let i = 0; i < 8; i += 1) {
      await act(async () => { jest.advanceTimersByTime(SLOW_RETRY_MS); await flush(); });
    }
    expect(ff.fn.mock.calls.length).toBeGreaterThanOrEqual(9);
  });

  it('retries at once when the browser comes back online', async () => {
    ff.fn.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    mount();
    await act(flush);
    expect(ff.fn).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('online')); await flush(); });
    expect(ff.fn).toHaveBeenCalledTimes(2);
  });

  it('stops for good on a real sign-out (401 after a refresh) and on unmount', async () => {
    ff.fn.mockImplementation((url: string) => Promise.resolve({ ok: false, status: 401, statusText: 'x' } as Response));
    const { hook } = mount();
    await act(flush);
    const calls = ff.fn.mock.calls.length; // stream, refresh (refused)
    await act(async () => { jest.advanceTimersByTime(SLOW_RETRY_MS * 3); await flush(); });
    expect(ff.fn.mock.calls.length).toBe(calls);
    hook.unmount();
  });

  it('does not reconnect after unmount', async () => {
    const { hook } = mount();
    await act(flush);
    hook.unmount();
    await act(async () => { jest.advanceTimersByTime(SLOW_RETRY_MS * 2); await flush(); });
    expect(ff.fn).toHaveBeenCalledTimes(1);
  });
});
