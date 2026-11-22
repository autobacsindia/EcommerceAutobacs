/**
 * The product-page heart: a short list of saved product ids kept ON THIS PHONE.
 *
 * Deliberately local and cheap (like a reel like): it never touches the cart,
 * prices or the account. The website's wishlist API supports several named
 * lists per customer; syncing the heart with it is a separate, later change.
 */
import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const KEY = 'autobacs.saved';
const LIMIT = 200;

let cache: string[] | null = null;
const listeners = new Set<(ids: string[]) => void>();

async function load(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function write(ids: string[]) {
  cache = ids;
  listeners.forEach((l) => l(ids));
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(ids));
  } catch {
    // Storage full/unavailable: the heart still works for this session.
  }
}

export function useSaved(productId: string | undefined) {
  const [ids, setIds] = useState<string[]>(cache ?? []);

  useEffect(() => {
    let live = true;
    load().then((v) => live && setIds(v));
    listeners.add(setIds);
    return () => {
      live = false;
      listeners.delete(setIds);
    };
  }, []);

  const saved = !!productId && ids.includes(productId);

  /** Returns the new state (true = now saved). */
  const toggle = useCallback(async (): Promise<boolean> => {
    if (!productId) return false;
    const current = await load();
    const next = current.includes(productId)
      ? current.filter((x) => x !== productId)
      : [productId, ...current].slice(0, LIMIT);
    await write(next);
    return next.includes(productId);
  }, [productId]);

  return { saved, toggle };
}
