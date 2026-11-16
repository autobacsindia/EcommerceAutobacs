'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether the customer has tapped "Apply Black Friday offer" — their INTENT only.
 *
 * The server decides whether the offer applies (it re-checks the live switch on every
 * quote and again when the order is created), so this flag never changes a price by
 * itself. Kept in sessionStorage so the choice made on the cart survives into checkout
 * in the same tab, and shared through a tiny store so every summary on the page agrees.
 * Storage can throw (private mode, blocked site data): it then lives in memory only.
 */
const KEY = 'ab:deliveryFeeOffer';
const listeners = new Set<() => void>();
let memory: boolean | null = null;

function read(): boolean {
  if (memory !== null) return memory;
  try {
    memory = typeof window !== 'undefined' && window.sessionStorage.getItem(KEY) === '1';
  } catch {
    memory = false;
  }
  return memory;
}

function write(next: boolean) {
  memory = next;
  try {
    if (next) window.sessionStorage.setItem(KEY, '1');
    else window.sessionStorage.removeItem(KEY);
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

export function useDeliveryFeeOffer(): [boolean, (next: boolean) => void] {
  // Server render: never applied (no storage) — avoids a hydration mismatch.
  const requested = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => write(next), []);
  return [requested, set];
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
