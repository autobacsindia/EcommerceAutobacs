import apiClient from '@/lib/api-client';

/**
 * Pop-up notifications on this device, even when the website is closed (the
 * browser must be running). The server keeps the device (POST /push/subscriptions)
 * and pushes for new chat messages and work updates; /push-sw.js shows them.
 *
 *   unsupported — this browser can't (or, on iPhone, the site is not on the Home Screen)
 *   unavailable — the server has no push keys yet
 *   blocked     — the person said "Block" in the browser; only they can undo it there
 *   off / on    — this device, for this person
 */
export type PushState = 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on';

const SW_URL = '/push-sw.js';

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

/** Ask the browser, register the worker, subscribe, and tell the server. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported() || needsHomeScreen()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const key = await serverKey();
  if (!key) return 'unavailable';
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
  await apiClient.post('/push/subscriptions', sub.toJSON());
  return 'on';
}

/** Stop pop-ups on this device (also called on logout — never throws). */
export async function disablePush(): Promise<PushState> {
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
