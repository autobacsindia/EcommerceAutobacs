/**
 * Keeping a device signed up for pop-ups (lib/push.ts).
 *
 * What must hold:
 *   - an already-allowed browser is re-signed up and saved on the server, with no prompt
 *   - it never asks the browser on its own, and never re-signs up after the person's "Turn off"
 *   - a subscription made with an old server key is replaced, not reused
 *   - logout turns this device off without remembering it; "Turn off" remembers
 */
const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { disablePush, enablePush, pushOptedOut, resyncPush } from './push';

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
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, ready: Promise.resolve(reg), getRegistration: async () => reg },
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
