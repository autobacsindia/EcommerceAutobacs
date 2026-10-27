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
  if (!pushSupported() || needsHomeScreen()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    if (!(await serverKey())) return 'unavailable';
    return (await currentSubscription()) ? 'on' : 'off';
  } catch {
    return 'off';
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
async function subscribeAndSave(key: string): Promise<PushState> {
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  await navigator.serviceWorker.ready;
  const want = keyBytes(key);
  let sub = await reg.pushManager.getSubscription();
  // Subscribed with an older key (the server's keys were changed): the push
  // service would refuse every send, and subscribing again over it throws.
  if (sub && !sameKey(sub.options?.applicationServerKey, want)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want as BufferSource }));
  await apiClient.post('/push/subscriptions', sub.toJSON());
  return 'on';
}

/** Ask the browser, register the worker, subscribe, and tell the server. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported() || needsHomeScreen()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const key = await serverKey();
  if (!key) return 'unavailable';
  rememberOptOut(false);
  return subscribeAndSave(key);
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
      return (await currentSubscription()) ? 'on' : 'off';
    }
    return await subscribeAndSave(key);
  } catch {
    return 'off';
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
  return 'off';
}

export const sendTestPush = () => apiClient.post<{ sent: number }>('/push/test', {});
