/**
 * Browser storage that never throws.
 *
 * In some browsers even READING `window.localStorage` throws ("Failed to read the
 * 'localStorage' property from 'Window': Access is denied for this document"):
 * Instagram/Facebook in-app browsers, "block all cookies" privacy settings, some
 * sandboxed iframes. A `typeof window` check does not help — the property access
 * itself is what throws — so the access AND the call both sit inside try/catch.
 * Writes can also throw when storage is full (QuotaExceededError).
 *
 * Everything here is best-effort: a blocked read returns null, a blocked write
 * returns false. Never store anything here the page cannot live without.
 */

type Kind = 'localStorage' | 'sessionStorage';

function store(kind: Kind): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window[kind] ?? null;
  } catch {
    return null;
  }
}

export interface SafeStorage {
  /** The stored string, or null when missing or storage is blocked. */
  get(key: string): string | null;
  /** True when the value was saved. */
  set(key: string, value: string): boolean;
  remove(key: string): void;
  /** Parsed JSON, or `fallback` when missing, blocked or not valid JSON. */
  getJSON<T>(key: string, fallback: T): T;
  /** JSON.stringify + set; false when blocked, full or not serialisable. */
  setJSON(key: string, value: unknown): boolean;
}

function make(kind: Kind): SafeStorage {
  const get = (key: string): string | null => {
    try {
      return store(kind)?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const set = (key: string, value: string): boolean => {
    try {
      const s = store(kind);
      if (!s) return false;
      s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  return {
    get,
    set,
    remove(key) {
      try {
        store(kind)?.removeItem(key);
      } catch {
        /* blocked: nothing to remove */
      }
    },
    getJSON<T>(key: string, fallback: T): T {
      const raw = get(key);
      if (raw == null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    setJSON(key, value) {
      let raw: string;
      try {
        raw = JSON.stringify(value);
      } catch {
        return false;
      }
      return set(key, raw);
    },
  };
}

export const safeLocal: SafeStorage = make('localStorage');
export const safeSession: SafeStorage = make('sessionStorage');
