import apiClient from '@/lib/api-client';

/**
 * Pop-up notifications on this device, even when the website is closed (the
 * browser must be running). The server keeps the device (POST /push/subscriptions)
 * and pushes for new chat messages and work updates (posted to chat as automatic
 * updates); /push-sw.js shows them.
 *
 *   unsupported — this browser can't (or, on iPhone, the site is not on the Home Screen)
 *   unavailable — the server has no push keys yet
 *   blocked     — the person said "Block" in the browser; only they can undo it there
 *   off / on    — this device, for this person
 *
 * Once the browser has said "Allow", the panel keeps this device signed up by
 * itself (`resyncPush`): logging out, a cleared server row or a new key would
 * otherwise turn pop-ups off silently, and nobody re-opens the bell to notice.
 * Only a person's own "Turn off" stops that, and it is remembered per browser.
 */
export type PushState = 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on';

const SW_URL = '/push-sw.js';

/*
 * The last state this page learnt for this browser. The chat sound reads it: with
 * the tab in the background and pop-ups on, the pop-up is the alert and the page
 * stays quiet (lib/chatSound.ts) — one sound per message, not two.
 */
let known: PushState | null = null;
const noteState = (s: PushState): PushState => { known = s; return s; };
export const pushIsOn = (): boolean => known === 'on';
const OPTED_OUT_KEY = 'roavion-push-off';

/** Did the person press "Turn off" in this browser? Browser storage may refuse. */
export function pushOptedOut(): boolean {
  try {
    return localStorage.getItem(OPTED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberOptOut(off: boolean) {
  try {
    if (off) localStorage.setItem(OPTED_OUT_KEY, '1');
    else localStorage.removeItem(OPTED_OUT_KEY);
  } catch {
    // Without storage the device simply re-signs up next time — the safe side.
  }
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhone / iPad Safari only allows web push for a site added to the Home Screen. */
export function needsHomeScreen(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function serverKey(): Promise<string | null> {
  const res = await apiClient.get<{ publicKey: string | null }>('/push/public-key');
  return res.publicKey || null;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg || !reg.active || !reg.active.scriptURL.endsWith(SW_URL)) return null;
  return reg.pushManager.getSubscription();
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported() || needsHomeScreen()) return noteState('unsupported');
  if (Notification.permission === 'denied') return noteState('blocked');
  try {
    if (!(await serverKey())) return noteState('unavailable');
    return noteState((await currentSubscription()) ? 'on' : 'off');
  } catch {
    return noteState('off');
  }
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Register the worker, make sure this browser holds a subscription for the
 * server's CURRENT key, and save it on the server (an upsert, so repeating it
 * is harmless and moves a shared device to whoever is signed in now).
 */
async function subscribeAndSave(key: string, { fresh = false }: { fresh?: boolean } = {}): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  await navigator.serviceWorker.ready;
  const want = keyBytes(key);
  let sub = await reg.pushManager.getSubscription();
  // Subscribed with an older key (the server's keys were changed): the push
  // service would refuse every send, and subscribing again over it throws.
  // `fresh`: the push service said this sign-up is dead — get a new one.
  if (sub && (fresh || !sameKey(sub.options?.applicationServerKey, want))) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want as BufferSource }));
  await apiClient.post('/push/subscriptions', sub.toJSON());
  return sub;
}

/** Ask the browser, register the worker, subscribe, and tell the server. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported() || needsHomeScreen()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const key = await serverKey();
  if (!key) return 'unavailable';
  rememberOptOut(false);
  await subscribeAndSave(key);
  return noteState('on');
}

/**
 * Keep this device signed up without asking anything: only when the browser
 * already allows notifications and the person has not turned them off here.
 * Never prompts, never throws — on any failure it just reports the state.
 */
export async function resyncPush(): Promise<PushState> {
  if (!pushSupported() || needsHomeScreen()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const key = await serverKey();
    if (!key) return 'unavailable';
    if (Notification.permission !== 'granted' || pushOptedOut()) {
      return noteState((await currentSubscription()) ? 'on' : 'off');
    }
    await subscribeAndSave(key);
    return noteState('on');
  } catch {
    return noteState('off');
  }
}

/**
 * Stop pop-ups on this device (never throws). `remember` is for the person's
 * own "Turn off": the panel then stops re-signing this browser up. Logout does
 * not remember — the next person to sign in here gets their own pop-ups.
 */
export async function disablePush({ remember = false }: { remember?: boolean } = {}): Promise<PushState> {
  if (remember) rememberOptOut(true);
  try {
    if (!pushSupported()) return 'unsupported';
    const sub = await currentSubscription();
    if (sub) {
      await apiClient.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => false);
    }
  } catch {
    // Logging out must never fail because of this.
  }
  return noteState('off');
}

export const sendTestPush = () => apiClient.post<{ sent: number }>('/push/test', {});

/**
 * What "Send me a test pop-up" found, for THIS browser:
 *   received      our worker in this browser got it and asked the computer to show it
 *                 — if nothing appeared, the computer is hiding it (Focus, settings)
 *   not-received  the push service took it, but this browser never said it arrived
 *   refused       the push service turns this browser down even after a fresh sign-up
 *   failed        the push service is having trouble; try again later
 */
export type TestOutcome = 'received' | 'not-received' | 'refused' | 'failed';
type TestReply = { sent: number; result?: 'sent' | 'gone' | 'refused' | 'failed' };

const TEST_WAIT_MS = 15000;
const statusOf = (e: unknown) => (e as { status?: number } | null)?.status;

/** Resolves true when the worker reports the test `id` arrived, false after `ms`. */
function waitForArrival(id: string, ms: number): { promise: Promise<boolean>; cancel: () => void } {
  let done: (v: boolean) => void = () => {};
  const promise = new Promise<boolean>((r) => { done = r; });
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type === 'roavion-push-received' && e.data.id === id) finish(true);
  };
  const timer = setTimeout(() => finish(false), ms);
  function finish(v: boolean) {
    clearTimeout(timer);
    navigator.serviceWorker.removeEventListener('message', onMessage);
    done(v);
  }
  navigator.serviceWorker.addEventListener('message', onMessage);
  return { promise, cancel: () => finish(false) };
}

/**
 * Send a test pop-up to this browser only and find out how far it got. A sign-up
 * the server no longer holds, or one the push service says is dead, is replaced
 * once and the test retried — the "automatic re-subscribe".
 */
export async function testThisBrowser({ waitMs = TEST_WAIT_MS }: { waitMs?: number } = {}): Promise<TestOutcome> {
  const key = await serverKey();
  if (!key) return 'failed';
  rememberOptOut(false);
  let sub = await subscribeAndSave(key);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const arrival = waitForArrival(id, waitMs);
    let reply: TestReply | null = null;
    try {
      reply = await apiClient.post<TestReply>('/push/test', { endpoint: sub.endpoint, testId: id });
    } catch (e) {
      arrival.cancel();
      if (statusOf(e) !== 409) throw e; // 409: the server does not hold this sign-up
    }
    if (reply?.result === 'sent' || (reply && !reply.result && reply.sent)) {
      return (await arrival.promise) ? 'received' : 'not-received';
    }
    arrival.cancel();
    if (reply?.result === 'failed') return 'failed';
    // Gone, refused, or not on the server: one fresh sign-up, then try again.
    if (attempt === 0) sub = await subscribeAndSave(key, { fresh: true });
  }
  return 'refused';
}

const KEEPALIVE_MS = 30 * 60 * 1000;

/**
 * Keep this browser signed up while a panel tab stays open for days: re-check
 * when the person comes back to the tab (at most every 30 minutes), and at once
 * when the worker says the browser replaced its sign-up. Returns a cleanup.
 */
export function startPushKeepAlive(onState?: (s: PushState) => void): () => void {
  if (!pushSupported()) return () => {};
  let last = Date.now();
  const run = () => { last = Date.now(); void resyncPush().then((s) => onState?.(s)); };
  const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - last >= KEEPALIVE_MS) run(); };
  const onMessage = (e: MessageEvent) => { if (e.data?.type === 'roavion-push-resubscribe') run(); };
  document.addEventListener('visibilitychange', onVisible);
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    navigator.serviceWorker.removeEventListener('message', onMessage);
  };
}
