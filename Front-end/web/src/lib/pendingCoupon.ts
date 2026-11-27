/**
 * A coupon code a landing page has handed the shopper, waiting to be applied in the cart.
 *
 * Presentation only. Storing a code here moves no money: the cart applies it through
 * the normal coupon endpoint, and the server decides — at apply and again at checkout —
 * whether it is valid, in scope and still unused by this customer. A tampered value is
 * just a wrong code the server refuses.
 *
 * Per-device, best effort: storage can be blocked (private mode, cleared data), so every
 * access is guarded and a failure simply means the shopper types the code themselves —
 * which the landing page shows them how to do.
 */

const KEY = 'roavion:pendingCoupon';
/** A card scanned months ago should not resurface on an unrelated cart. */
export const PENDING_COUPON_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_RE = /^[A-Z0-9-]{3,32}$/;

type Stored = { code: string; savedAt: number };

export function savePendingCoupon(code: string, now = Date.now()): void {
  const clean = code.trim().toUpperCase();
  if (!CODE_RE.test(clean)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ code: clean, savedAt: now } satisfies Stored));
  } catch {
    /* storage blocked — the page still shows the code to type */
  }
}

export function readPendingCoupon(now = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.code !== 'string' || !CODE_RE.test(parsed.code)) return null;
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > PENDING_COUPON_TTL_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

export function clearPendingCoupon(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
