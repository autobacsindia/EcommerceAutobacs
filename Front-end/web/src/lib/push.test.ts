/**
 * Keeping a device signed up for pop-ups (lib/push.ts).
 *
 * What must hold:
 *   - an already-allowed browser is re-signed up and saved on the server, with no prompt
 *   - it never asks the browser on its own, and never re-signs up after the person's "Turn off"
 *   - a subscription made with an old server key is replaced, not reused
 *   - logout turns this device off without remembering it; "Turn off" remembers
 *   - "send me a test" targets THIS browser and reports how far it got; a sign-up
 *     the server lost or the push service rejects is replaced once, then retried
 *   - an open tab re-checks its sign-up when the person returns (at most every
 *     30 min) and at once when the worker says the browser replaced it
 */
const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { disablePush, enablePush, pushOptedOut, resyncPush, startPushKeepAlive, testThisBrowser } from './push';

// "AQID" is base64url for bytes [1, 2, 3].
const KEY = 'AQID';
const keyBuffer = (bytes: number[]) => new Uint8Array(bytes).buffer;

type FakeSub = { endpoint: string; options: { applicationServerKey: ArrayBuffer | null }; toJSON: () => object; unsubscribe: jest.Mock };
const fakeSub = (bytes: number[], endpoint = 'https://fcm.googleapis.com/fcm/send/x'): FakeSub => ({
  endpoint,
  options: { applicationServerKey: keyBuffer(bytes) },
  toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: jest.fn().mockResolvedValue(true),
});

let existing: FakeSub | null;
let sw: EventTarget;
/** What the worker would post to the page. */
const fromWorker = (data: object) => sw.dispatchEvent(Object.assign(new Event('message'), { data }));
const subscribe = jest.fn();
const register = jest.fn();
let permission: NotificationPermission;
const requestPermission = jest.fn();

beforeEach(() => {
  get.mockReset().mockResolvedValue({ publicKey: KEY });
  post.mockReset().mockResolvedValue({});
  existing = null;
  subscribe.mockReset().mockImplementation(async () => { existing = fakeSub([1, 2, 3], 'https://fcm.googleapis.com/fcm/send/new'); return existing; });
  const reg = {
    active: { scriptURL: 'https://www.autobacsindia.com/push-sw.js' },
    pushManager: { getSubscription: async () => existing, subscribe },
  };
  register.mockReset().mockResolvedValue(reg);
  sw = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: Object.assign(sw, { register, ready: Promise.resolve(reg), getRegistration: async () => reg }),
  });
  (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  permission = 'granted';
  requestPermission.mockReset().mockImplementation(async () => permission);
  (window as unknown as { Notification: unknown }).Notification = {
    get permission() { return permission; },
    requestPermission,
  };
  localStorage.clear();
});

it('an allowed browser with no subscription is signed up and saved — without asking', async () => {
  expect(await resyncPush()).toBe('on');
  expect(requestPermission).not.toHaveBeenCalled();
  expect(register).toHaveBeenCalledWith('/push-sw.js', { scope: '/' });
  expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  expect(post).toHaveBeenCalledWith('/push/subscriptions', expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/new' }));
});

it('an existing subscription for the current key is re-saved, not replaced', async () => {
  existing = fakeSub([1, 2, 3]);
  const before = existing;
  expect(await resyncPush()).toBe('on');
  expect(subscribe).not.toHaveBeenCalled();
  expect(before.unsubscribe).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith('/push/subscriptions', expect.objectContaining({ endpoint: before.endpoint }));
});

it('a subscription made with an old server key is replaced', async () => {
  existing = fakeSub([9, 9, 9]);
  const old = existing;
  expect(await resyncPush()).toBe('on');
  expect(old.unsubscribe).toHaveBeenCalled();
  expect(subscribe).toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith('/push/subscriptions', expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/new' }));
});

it('never asks the browser by itself: not yet allowed → "off", nothing saved', async () => {
  permission = 'default';
  expect(await resyncPush()).toBe('off');
  expect(requestPermission).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it('blocked in the browser → "blocked"; no server keys → "unavailable"', async () => {
  permission = 'denied';
  expect(await resyncPush()).toBe('blocked');
  permission = 'granted';
  get.mockResolvedValue({ publicKey: null });
  expect(await resyncPush()).toBe('unavailable');
  expect(post).not.toHaveBeenCalled();
});

it('after the person\'s own "Turn off" it stays off; "Turn on" clears that', async () => {
  existing = fakeSub([1, 2, 3]);
  await disablePush({ remember: true });
  expect(pushOptedOut()).toBe(true);
  expect(post).toHaveBeenCalledWith('/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/x' });
  existing = null;
  post.mockClear();
  expect(await resyncPush()).toBe('off');
  expect(post).not.toHaveBeenCalled();

  expect(await enablePush()).toBe('on');
  expect(pushOptedOut()).toBe(false);
});

it('logout turns the device off but does not remember it, so the next sign-in re-signs up', async () => {
  existing = fakeSub([1, 2, 3]);
  await disablePush();
  expect(pushOptedOut()).toBe(false);
  existing = null;
  expect(await resyncPush()).toBe('on');
});

it('a failing server never throws out of resync', async () => {
  post.mockRejectedValue(new Error('down'));
  await expect(resyncPush()).resolves.toBe('off');
});

describe('send me a test pop-up', () => {
  const tests = () => post.mock.calls.filter(([url]) => url === '/push/test');
  /** The server answers the test, and (optionally) the worker reports it arrived. */
  const serverSays = (...replies: Array<object | Error>) => {
    post.mockImplementation(async (url: string, body: { testId?: string }) => {
      if (url !== '/push/test') return {};
      const r = replies.shift();
      if (r instanceof Error) throw r;
      if ((r as { arrive?: boolean }).arrive) setTimeout(() => fromWorker({ type: 'roavion-push-received', id: body.testId, shown: true }), 5);
      return r;
    });
  };
  const conflict = Object.assign(new Error('not on the server'), { status: 409 });

  it('goes to this browser only and comes back "received" when the worker reports it', async () => {
    existing = fakeSub([1, 2, 3]);
    serverSays({ sent: 1, result: 'sent', arrive: true });
    expect(await testThisBrowser({ waitMs: 500 })).toBe('received');
    expect(tests()).toHaveLength(1);
    expect(tests()[0][1]).toEqual({ endpoint: existing.endpoint, testId: expect.stringMatching(/^[\w-]{8,40}$/) });
  });

  it('a report for a different test does not count; silence is "not received"', async () => {
    existing = fakeSub([1, 2, 3]);
    serverSays({ sent: 1, result: 'sent' });
    setTimeout(() => fromWorker({ type: 'roavion-push-received', id: 'someone-elses-test' }), 5);
    expect(await testThisBrowser({ waitMs: 60 })).toBe('not-received');
  });

  it('a sign-up the push service says is gone is replaced and the test retried', async () => {
    existing = fakeSub([1, 2, 3]);
    const dead = existing;
    serverSays({ sent: 0, result: 'gone' }, { sent: 1, result: 'sent', arrive: true });
    expect(await testThisBrowser({ waitMs: 500 })).toBe('received');
    expect(dead.unsubscribe).toHaveBeenCalled();
    expect(tests().map(([, b]) => b.endpoint)).toEqual([dead.endpoint, 'https://fcm.googleapis.com/fcm/send/new']);
  });

  it('a sign-up the server no longer holds (409) is saved again and retried', async () => {
    existing = fakeSub([1, 2, 3]);
    serverSays(conflict, { sent: 1, result: 'sent', arrive: true });
    expect(await testThisBrowser({ waitMs: 500 })).toBe('received');
    expect(post.mock.calls.filter(([url]) => url === '/push/subscriptions').length).toBeGreaterThanOrEqual(2);
  });

  it('refused twice is "refused"; the push service\'s own trouble is "failed" with no retry', async () => {
    existing = fakeSub([1, 2, 3]);
    serverSays({ sent: 0, result: 'refused' }, { sent: 0, result: 'refused' });
    expect(await testThisBrowser({ waitMs: 50 })).toBe('refused');
    expect(tests()).toHaveLength(2);
    post.mockClear();
    serverSays({ sent: 0, result: 'failed' });
    expect(await testThisBrowser({ waitMs: 50 })).toBe('failed');
    expect(tests()).toHaveLength(1);
  });

  it('a test also clears an earlier "Turn off" on this browser', async () => {
    localStorage.setItem('roavion-push-off', '1');
    serverSays({ sent: 1, result: 'sent', arrive: true });
    await testThisBrowser({ waitMs: 500 });
    expect(pushOptedOut()).toBe(false);
  });
});

describe('keeping an open tab signed up', () => {
  const saves = () => post.mock.calls.filter(([url]) => url === '/push/subscriptions').length;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  let visibility: DocumentVisibilityState;
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'queueMicrotask', 'nextTick'] });
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });
  afterEach(() => jest.useRealTimers());

  it('re-saves when the person comes back after 30 minutes, not on every glance', async () => {
    const stop = startPushKeepAlive();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(saves()).toBe(0);
    jest.setSystemTime(Date.now() + 31 * 60 * 1000);
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 5; i += 1) await settle();
    expect(saves()).toBe(1);
    stop();
  });

  it('re-saves at once when the worker says the browser replaced the sign-up', async () => {
    const stop = startPushKeepAlive();
    fromWorker({ type: 'roavion-push-resubscribe' });
    for (let i = 0; i < 5; i += 1) await settle();
    expect(saves()).toBe(1);
    stop();
    fromWorker({ type: 'roavion-push-resubscribe' });
    for (let i = 0; i < 5; i += 1) await settle();
    expect(saves()).toBe(1); // stopped: no more
  });
});
