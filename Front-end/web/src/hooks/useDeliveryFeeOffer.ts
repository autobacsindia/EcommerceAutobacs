'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useDeliveryFeesPublic } from '@/hooks/queries/useDeliveryFeesPublic';

/**
 * Whether to ask the server for the Black Friday delivery-fee waiver — INTENT only.
 *
 * The server decides whether the offer applies (it re-checks the live switch on every
 * quote and again when the order is created), so this flag never changes a price by
 * itself. Three states, kept in sessionStorage so a choice on the cart survives into
 * checkout in the same tab and every summary on the page agrees:
 *
 *   - no choice yet → AUTO: asked for whenever the offer is live and a PIN is known
 *     (a customer once missed the "Apply" tap, saw ₹8,367 of fees and left);
 *   - '1' → the customer tapped "Apply": always asked for (a PIN-less tap still gets the
 *     server's "enter your PIN first" answer, as before);
 *   - '0' → the customer tapped "Remove": never auto-applied again this session.
 *
 * Storage can throw (private mode, blocked site data): it then lives in memory only.
 */
type Choice = 'on' | 'off' | 'auto';
const KEY = 'ab:deliveryFeeOffer';
const listeners = new Set<() => void>();
let memory: Choice | null = null;

function read(): Choice {
  if (memory !== null) return memory;
  try {
    const v = typeof window !== 'undefined' ? window.sessionStorage.getItem(KEY) : null;
    memory = v === '1' ? 'on' : v === '0' ? 'off' : 'auto';
  } catch {
    memory = 'auto';
  }
  return memory;
}

function write(next: boolean) {
  memory = next ? 'on' : 'off';
  try {
    window.sessionStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    /* in-memory only */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Test seam: forget the remembered choice. */
export function resetDeliveryFeeOfferIntent() {
  memory = null;
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

const VALID_PIN = /^[1-9]\d{5}$/;

/** Pure decision, exported for tests: should this quote ask for the waiver? */
export function shouldRequestOffer(choice: Choice, offerLive: boolean, pin: string | undefined): boolean {
  if (choice === 'on') return true;
  if (choice === 'off') return false;
  return offerLive && VALID_PIN.test(pin ?? '');
}

/**
 * @param pin the PIN this quote is priced for (typed on the cart, or the shipping
 *   address's own PIN at the review step). Auto-apply waits for a valid one.
 */
export function useDeliveryFeeOffer(pin?: string): [boolean, (next: boolean) => void] {
  // Server render: 'auto' with the offer unknown → not requested (no hydration mismatch).
  const choice = useSyncExternalStore(subscribe, read, () => 'auto' as Choice);
  const { offerLive } = useDeliveryFeesPublic();
  const set = useCallback((next: boolean) => write(next), []);
  return [shouldRequestOffer(choice, offerLive, pin), set];
}

/*
  The "Congratulations, you saved ₹X" popup shows once per browser session — not again
  on every PIN change or re-quote. The inline "You saved ₹X" lines stay regardless.
*/
const CELEBRATED_KEY = 'ab:deliveryFeeOfferCelebrated';
let celebratedMemory = false;

export function hasCelebratedOffer(): boolean {
  if (celebratedMemory) return true;
  try { return window.sessionStorage.getItem(CELEBRATED_KEY) === '1'; } catch { return false; }
}

export function markOfferCelebrated() {
  celebratedMemory = true;
  try { window.sessionStorage.setItem(CELEBRATED_KEY, '1'); } catch { /* in-memory only */ }
}

/** Test seam. */
export function resetOfferCelebrated() {
  celebratedMemory = false;
  try { window.sessionStorage.removeItem(CELEBRATED_KEY); } catch { /* ignore */ }
}

/*
  The delivery PIN typed on the cart, so checkout's first step can price the same fees
  before an address is chosen. Display convenience only: the order is always priced
  from the shipping address's own PIN.
*/
const PIN_KEY = 'ab:deliveryPin';
const pinListeners = new Set<() => void>();
let pinMemory: string | null = null;

function readPin(): string {
  if (pinMemory !== null) return pinMemory;
  try {
    const v = typeof window !== 'undefined' ? window.sessionStorage.getItem(PIN_KEY) || '' : '';
    pinMemory = /^[1-9]\d{5}$/.test(v) ? v : '';
  } catch {
    pinMemory = '';
  }
  return pinMemory;
}

export function useDeliveryPin(): [string, (pin: string) => void] {
  const pin = useSyncExternalStore(
    (l) => { pinListeners.add(l); return () => { pinListeners.delete(l); }; },
    readPin,
    () => '',
  );
  const set = useCallback((next: string) => {
    pinMemory = /^[1-9]\d{5}$/.test(next) ? next : '';
    try {
      if (pinMemory) window.sessionStorage.setItem(PIN_KEY, pinMemory);
      else window.sessionStorage.removeItem(PIN_KEY);
    } catch { /* in-memory only */ }
    pinListeners.forEach((l) => l());
  }, []);
  return [pin, set];
}
