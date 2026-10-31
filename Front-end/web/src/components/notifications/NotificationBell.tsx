'use client';

/**
 * The header bell: one place that says whether anything needs this person.
 *
 * ── The problem it solves ───────────────────────────────────────────────────
 * Work arrives in queues scattered across the panel — a payment for accounts to
 * approve, an approved one for the admin to pay, a refund to send, a message in
 * team chat. Nothing announced any of it, so people opened each section to
 * check, a few times a day, or forgot. The bell is the single thing to glance
 * at.
 *
 * ── Why the badge matters more than the sound ───────────────────────────────
 * Browsers refuse to play audio until the person has interacted with the page,
 * and the rule cannot be opted out of. So on a tab nobody has clicked yet the
 * first chime is silent — and anything built to depend on the sound would have
 * a hole in it exactly then. The badge is the signal; the chime is a courtesy
 * that makes you look sooner.
 *
 * ── Why it can be muted, and why that is remembered ─────────────────────────
 * This fires on someone else's machine, in an office, possibly often. A sound
 * that cannot be switched off gets the whole feature disabled instead — people
 * close the tab. The toggle is right there in the panel and persists.
 *
 * ── Why the chime only follows a RISE ───────────────────────────────────────
 * It plays when the total goes UP, never on the first load and never when work
 * is cleared. Chiming on mount would mean a chime on every page navigation, and
 * chiming on a falling count would congratulate you for finishing something.
 *
 * ── Why a rise is not always a sound ────────────────────────────────────────
 * The chat chime rang over and over: once per open tab, once per message in a
 * burst, for every automatic order update, for the chat being read, and on top
 * of the computer's own pop-up sound. lib/chatSound.ts holds the rules that stop
 * that (once per message across tabs, a cool-down, updates silent unless chosen,
 * not the open conversation, not when a pop-up already rang).
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Volume2, VolumeX } from 'lucide-react';
import { useWaitingWork } from '@/hooks/queries/useNotifications';
import { useChatChannels, useChatUnreadSplit } from '@/hooks/queries/useTeamChat';
import PushToggle from './PushToggle';
import { alert, arm, chime, muted as isMuted, setMuted } from '@/lib/notificationChime';
import { claimAlert, claimChime, openConversation, setUpdatesSound, soundWorthy, updatesSoundOn } from '@/lib/chatSound';
import { pushIsOn } from '@/lib/push';

export default function NotificationBell({
  chatHref,
  tone = 'light',
}: {
  chatHref: string;
  /** The admin header is white; the team sidebar is near-black. Only the
   *  button changes — the panel is a popover and stays light on both. */
  tone?: 'light' | 'dark';
}) {
  const { data } = useWaitingWork();
  const unreadSplit = useChatUnreadSplit();
  const { data: channels } = useChatChannels({ poll: true });
  // The badge counts both kinds; the sound is filtered (see below).
  const chatUnread = unreadSplit.chat + unreadSplit.updates;
  const [open, setOpen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [updatesSound, setUpdatesSoundState] = useState(false);

  const approvals = data?.total ?? 0;
  const total = approvals + chatUnread;

  // `undefined` until the first count arrives, so the first render cannot be
  // read as a rise from zero.
  const previous = useRef<number | undefined>(undefined);

  useEffect(() => { setQuiet(isMuted()); setUpdatesSoundState(updatesSoundOn()); }, []);

  /*
    Audio needs a real user gesture before it will ever play. Arming on the
    first click anywhere — not on the bell, which the person may never press —
    is what makes the chime work for someone who just opened the panel and
    started working.
  */
  useEffect(() => {
    const onFirstGesture = () => arm();
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    window.addEventListener('keydown', onFirstGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
  }, []);

  /*
    Two sounds, so you can tell without looking: new WORK (payments, orders,
    refunds — `approvals`) plays the "ding-dong" alert; a new CHAT message plays
    the chat chime. If both rise at once, the work alert wins — it is the one
    that usually needs action.
  */
  const alertedAt = useRef(0);
  useEffect(() => {
    if (!data) return;
    const before = previous.current;
    previous.current = approvals;
    if (before === undefined || approvals <= before) return;
    alertedAt.current = Date.now();
    void claimAlert(approvals).then((mine) => { if (mine) alert(); });
  }, [data, approvals]);

  const previousSound = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!channels) return;
    const visible = document.visibilityState === 'visible';
    const { count, newestAt } = soundWorthy({ channels, openId: visible ? openConversation() : null, updatesSound });
    const before = previousSound.current;
    previousSound.current = count;
    if (before === undefined || count <= before) return;
    // The work alert just rang for the same change: it is the one that needs action.
    const workRang = Date.now() - alertedAt.current < 2000;
    // In the background with pop-ups on, the computer's pop-up is the sound.
    const popUpRang = !visible && pushIsOn();
    void claimChime(newestAt).then((mine) => { if (mine && !workRang && !popUpRang) chime(); });
  }, [channels, updatesSound]);

  // Click-away. Pointerdown rather than click, so the panel is gone before the
  // thing underneath reacts.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[data-bell]')) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /*
    People's messages and automatic order updates are separate rows, each opening
    its own tab: "Unread order updates" goes straight to the Order updates tab of
    the space that got the latest one.
  */
  const rows = [
    ...(unreadSplit.chat > 0 ? [{ key: 'chat', label: 'Unread messages', count: unreadSplit.chat, href: chatHref }] : []),
    ...(unreadSplit.updates > 0 ? [{
      key: 'chat_updates',
      label: 'Unread order updates',
      count: unreadSplit.updates,
      href: unreadSplit.updatesChannelId ? `${chatHref}?c=${unreadSplit.updatesChannelId}&t=updates` : chatHref,
    }] : []),
    ...(data?.items ?? []),
  ];

  return (
    <div className="relative" data-bell>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative rounded-lg p-2 transition-colors ${
          tone === 'dark'
            ? 'text-gray-300 hover:bg-gray-800 hover:text-white'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`}
        aria-label={total > 0 ? `Notifications, ${total} waiting` : 'Notifications, nothing waiting'}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-[11px] font-bold leading-[18px] text-white"
            // The number is already in the button's label; announcing it twice
            // makes a screen reader read the count and then the count again.
            aria-hidden="true"
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ${
            // In the team sidebar the bell sits at the sidebar's right edge: open towards
            // the page (right), or the panel is cut off by the screen's left edge. In the
            // admin header (top right) open towards the left. On phones, span the screen.
            tone === 'dark' ? 'left-0' : 'right-0'
          } max-sm:fixed max-sm:inset-x-2 max-sm:top-16 max-sm:w-auto max-sm:max-w-none`}
          role="menu"
          aria-label="What is waiting"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-semibold text-gray-900">Waiting for you</span>
            <button
              type="button"
              onClick={() => { const next = !quiet; setQuiet(next); setMuted(next); if (!next) chime(); }}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
              aria-label={quiet ? 'Turn the notification sound on' : 'Turn the notification sound off'}
              title={quiet ? 'Sound off' : 'Sound on'}
            >
              {quiet ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
          {!quiet && (
            <div className="space-y-1 border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <span>Hear the sounds:</span>
                <button type="button" onClick={() => { arm(); chime(); }} className="rounded px-1.5 py-0.5 font-medium text-gray-700 hover:bg-gray-100">Chat</button>
                <button type="button" onClick={() => { arm(); alert(); }} className="rounded px-1.5 py-0.5 font-medium text-gray-700 hover:bg-gray-100">New work</button>
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={updatesSound}
                  onChange={(e) => { setUpdatesSound(e.target.checked); setUpdatesSoundState(e.target.checked); }}
                  className="h-3.5 w-3.5"
                />
                <span>Sound for automatic order updates too</span>
              </label>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-500">Nothing waiting. You are all caught up.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.key}>
                  <Link
                    href={r.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-gray-50"
                    role="menuitem"
                  >
                    <span className={r.count > 0 ? 'font-medium text-gray-900' : 'text-gray-500'}>{r.label}</span>
                    <span
                      className={`min-w-[22px] rounded-full px-1.5 text-center text-xs font-bold leading-5 ${
                        r.count > 0 ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {r.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {/* At the bottom: set once per device, then rarely needed. */}
          <div className="border-t border-gray-100"><PushToggle /></div>
        </div>
      )}
    </div>
  );
}
