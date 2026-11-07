'use client';

/**
 * The chat's computer layout choices, remembered per person on this browser:
 *
 * - the left sections folded to a slim icon rail (Google Chat's ☰), and
 * - how wide the Home list is, set by dragging the line between it and the
 *   open conversation.
 *
 * Both are conveniences only: storage can be missing or blocked (private
 * window, cleared site data), and then the choice simply isn't remembered.
 * The width maths are pure functions so they are tested without a browser.
 */
import { useCallback, useEffect, useState } from 'react';

/** The Home list's width limits, in pixels. */
export const LIST_MIN = 260;
export const LIST_MAX = 520;
export const LIST_DEFAULT = 340;
/** One arrow-key press moves the line this far; with Shift, three times as far. */
export const LIST_STEP = 16;
/** Dragging this far past the narrowest width hides the lists (as the old "<" button did). */
export const LIST_HIDE_PAST = 80;

const RAIL_PREFIX = 'roavion-chat-rail:';
const WIDTH_PREFIX = 'roavion-chat-list-w:';
export const railKey = (userId: string) => `${RAIL_PREFIX}${userId}`;
export const widthKey = (userId: string) => `${WIDTH_PREFIX}${userId}`;

/** Keeps a width inside the limits; anything unreadable becomes the default. */
export function clampListWidth(w: number): number {
  if (!Number.isFinite(w)) return LIST_DEFAULT;
  return Math.min(LIST_MAX, Math.max(LIST_MIN, Math.round(w)));
}

/** The width a key press on the focused line leads to, or null for keys it ignores. */
export function widthForKey(current: number, key: string, shift = false): number | null {
  const step = shift ? LIST_STEP * 3 : LIST_STEP;
  switch (key) {
    case 'ArrowLeft': return clampListWidth(current - step);
    case 'ArrowRight': return clampListWidth(current + step);
    case 'Home': return LIST_MIN;
    case 'End': return LIST_MAX;
    default: return null;
  }
}

/** Whether a drag that ended at this (unclamped) width means "hide the lists". */
export const dragHidesList = (rawWidth: number) => rawWidth < LIST_MIN - LIST_HIDE_PAST;

export function readRail(userId: string): boolean {
  if (!userId) return false;
  try { return localStorage.getItem(railKey(userId)) === '1'; } catch { return false; }
}
export function saveRail(userId: string, on: boolean): void {
  if (!userId) return;
  try {
    if (on) localStorage.setItem(railKey(userId), '1');
    else localStorage.removeItem(railKey(userId));
  } catch { /* storage unavailable: lasts until the page is closed */ }
}

export function readListWidth(userId: string): number {
  if (!userId) return LIST_DEFAULT;
  try {
    const raw = localStorage.getItem(widthKey(userId));
    return raw === null ? LIST_DEFAULT : clampListWidth(Number(raw));
  } catch { return LIST_DEFAULT; }
}
export function saveListWidth(userId: string, w: number): void {
  if (!userId) return;
  try {
    const v = clampListWidth(w);
    if (v === LIST_DEFAULT) localStorage.removeItem(widthKey(userId));
    else localStorage.setItem(widthKey(userId), String(v));
  } catch { /* storage unavailable */ }
}

/**
 * The left sections folded to icons, or not. Starts unfolded (so the server
 * render and the first client render agree), then picks up the saved choice
 * once the signed-in user is known.
 */
export function useChatRail(userId: string): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [rail, setRailState] = useState(false);
  useEffect(() => { setRailState(readRail(userId)); }, [userId]);
  const setRail = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setRailState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      saveRail(userId, value);
      return value;
    });
  }, [userId]);
  return [rail, setRail];
}

/**
 * The Home list's width. `setWidth` moves it on screen only (cheap enough to
 * call on every pointer move); `commit` also saves it, once the drag or key
 * press is over.
 */
export function useListWidth(userId: string) {
  const [width, setWidthState] = useState(LIST_DEFAULT);
  useEffect(() => { setWidthState(readListWidth(userId)); }, [userId]);
  const setWidth = useCallback((w: number) => setWidthState(clampListWidth(w)), []);
  const commit = useCallback((w: number) => {
    const v = clampListWidth(w);
    setWidthState(v);
    saveListWidth(userId, v);
  }, [userId]);
  return { width, setWidth, commit };
}
