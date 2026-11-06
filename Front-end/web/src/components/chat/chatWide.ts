'use client';

/**
 * "Wide chat": the open conversation takes the whole chat area and the left
 * sections + Home list slide away. Remembered per person on this browser — a
 * convenience only, so a missing or blocked storage (private window, blocked
 * site data) simply means "not remembered", never an error.
 */
import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'roavion-chat-wide:';

export const wideKey = (userId: string) => `${PREFIX}${userId}`;

export function readWide(userId: string): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(wideKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function saveWide(userId: string, on: boolean): void {
  if (!userId) return;
  try {
    if (on) localStorage.setItem(wideKey(userId), '1');
    else localStorage.removeItem(wideKey(userId));
  } catch {
    /* storage unavailable: the choice lasts until the page is closed */
  }
}

/**
 * The wide-chat choice for this person. Starts narrow (so the server render and
 * the first client render agree), then picks up the saved choice once the
 * signed-in user is known; a different user on the same browser gets their own.
 */
export function useChatWide(userId: string): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [wide, setWideState] = useState(false);

  useEffect(() => {
    setWideState(readWide(userId));
  }, [userId]);

  const setWide = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setWideState((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        saveWide(userId, value);
        return value;
      });
    },
    [userId]
  );

  return [wide, setWide];
}
