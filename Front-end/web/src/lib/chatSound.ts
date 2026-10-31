/**
 * When the chat sound may play — the rules, kept apart from the bell so they can
 * be tested on their own.
 *
 * ── Why these rules exist ───────────────────────────────────────────────────
 * The bell plays the chat chime when the unread count rises. On its own that
 * rang far too often:
 *   • every open panel tab has its own bell, and background tabs keep checking
 *     (so they can ring), so three tabs rang three times for one message;
 *   • automatic order updates ("shipped", "delivered", refunds…) count as chat,
 *     and the admin is in every space — a sound every few minutes on a busy day;
 *   • a burst of messages rang once per message;
 *   • a message in the conversation you were reading still rang;
 *   • with the tab in the background the computer's pop-up already made a sound.
 *
 * ── What holds now ──────────────────────────────────────────────────────────
 *   1. Once per message, across every tab: the newest message time that rang is
 *      shared in browser storage, and a tab only rings for something newer.
 *      (A Web Lock serialises the check, so two tabs polling at the same moment
 *      cannot both ring.) A count that dips and comes back — a stale refresh —
 *      carries no newer message, so it cannot ring twice either.
 *   2. A cool-down: at most one chat sound every COOLDOWN_MS, shared by all tabs.
 *   3. Order updates are silent unless the person turns their sound on (bell).
 *   4. Nothing for the conversation open on a visible screen.
 *   5. Tab in the background and pop-ups on for this browser: the pop-up is the
 *      alert, so the page stays quiet.
 * The badge still counts everything; only the sound is filtered.
 */
import type { ChatChannel } from '@/hooks/queries/useTeamChat';
import { countedUnread } from '@/hooks/queries/useTeamChat';

export const COOLDOWN_MS = 15_000;
const SEEN_KEY = 'roavion-chime-seen';
const LAST_KEY = 'roavion-chime-last';
const UPDATES_KEY = 'roavion-notify-updates-sound';
const LOCK = 'roavion-chime';

function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key) || 0) || 0;
  } catch {
    return 0;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Blocked storage: this tab still applies the rules for itself.
  }
}

/** Does this person want a sound for automatic order updates? Off unless chosen. */
export function updatesSoundOn(): boolean {
  try {
    return localStorage.getItem(UPDATES_KEY) === '1';
  } catch {
    return false;
  }
}

export function setUpdatesSound(on: boolean): void {
  try {
    localStorage.setItem(UPDATES_KEY, on ? '1' : '0');
  } catch {
    // Lasts for this page only.
  }
}

// The conversation on screen (TeamChat sets it while mounted).
let openChannelId: string | null = null;
export function setOpenConversation(id: string | null): void { openChannelId = id; }
export const openConversation = (): string | null => openChannelId;

export type SoundInput = {
  channels: ChatChannel[];
  /** The conversation on screen, if the screen is visible. */
  openId: string | null;
  updatesSound: boolean;
};

/**
 * What may ring right now: how many unread messages count towards the sound,
 * and the time of the newest of them (0 when none).
 */
export function soundWorthy({ channels, openId, updatesSound }: SoundInput): { count: number; newestAt: number } {
  let count = 0;
  let newestAt = 0;
  for (const c of channels) {
    if (openId && c.id === openId) continue;
    const u = countedUnread(c);
    const n = u.chat + (updatesSound ? u.updates : 0);
    if (n <= 0) continue;
    count += n;
    const at = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
    if (at > newestAt) newestAt = at;
  }
  return { count, newestAt };
}

/**
 * Claim the right to ring for a message that arrived at `messageAt`. True for
 * exactly one tab, once per message, and not within COOLDOWN_MS of the last ring.
 * Synchronous; call it under the lock (claimChime) when tabs may race.
 */
export function claimChimeNow(messageAt: number, now = Date.now()): boolean {
  if (!messageAt || messageAt <= readNumber(SEEN_KEY)) return false;
  writeNumber(SEEN_KEY, messageAt);
  if (now - readNumber(LAST_KEY) < COOLDOWN_MS) return false;
  writeNumber(LAST_KEY, now);
  return true;
}

/** claimChimeNow under a Web Lock shared by every tab of the site (where the browser has one). */
export async function claimChime(messageAt: number): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return claimChimeNow(messageAt);
  try {
    return await locks.request(LOCK, () => claimChimeNow(messageAt));
  } catch {
    return claimChimeNow(messageAt);
  }
}

const ALERT_KEY = 'roavion-alert-seen';
const ALERT_WINDOW_MS = 60_000;

/**
 * The work "ding-dong" keeps its own rule — every rise in waiting work — but one
 * tab plays it, not every open tab: a tab skips it when another rang for at
 * least this many waiting items within the last minute.
 */
export function claimAlertNow(waiting: number, now = Date.now()): boolean {
  try {
    const last = JSON.parse(localStorage.getItem(ALERT_KEY) || 'null') as { n: number; at: number } | null;
    if (last && now - last.at < ALERT_WINDOW_MS && last.n >= waiting) return false;
    localStorage.setItem(ALERT_KEY, JSON.stringify({ n: waiting, at: now }));
  } catch {
    // Blocked storage: ring in this tab.
  }
  return true;
}

export async function claimAlert(waiting: number): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return claimAlertNow(waiting);
  try {
    return await locks.request(`${LOCK}-alert`, () => claimAlertNow(waiting));
  } catch {
    return claimAlertNow(waiting);
  }
}
