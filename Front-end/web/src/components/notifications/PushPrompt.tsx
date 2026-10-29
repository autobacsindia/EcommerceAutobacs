'use client';

import { useEffect, useState } from 'react';
import { BellRing, Loader2, X } from 'lucide-react';
import { enablePush, needsHomeScreen, pushOptedOut, resyncPush, type PushState } from '@/lib/push';

/**
 * The strip at the top of the team / admin panel that gets pop-ups switched on.
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 * Pop-ups are the only signal that reaches someone in another tab or another
 * app — the bell and its sounds belong to the page. But the switch lived at the
 * bottom of the bell's drop-down and nothing ever pointed at it, so in practice
 * nobody turned it on and new work arrived in silence.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 * On load it quietly keeps an already-allowed browser signed up (`resyncPush`),
 * then shows itself only if there is something the person can do: turn pop-ups
 * on, unblock them, or (iPhone) add the site to the Home Screen. "Not now" hides
 * it for a week; a person who pressed "Turn off" in the bell never sees it.
 */
const SNOOZE_KEY = 'roavion-push-prompt-snooze';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // Without storage it simply shows again on the next visit.
  }
}

type Shown = 'ask' | 'blocked' | 'homescreen' | 'done' | null;

function shownFor(state: PushState): Shown {
  if (snoozed()) return null;
  if (state === 'off') return pushOptedOut() ? null : 'ask';
  if (state === 'blocked') return 'blocked';
  if (state === 'unsupported' && needsHomeScreen()) return 'homescreen';
  return null;
}

export default function PushPrompt() {
  const [shown, setShown] = useState<Shown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    resyncPush().then((s) => { if (alive) setShown(shownFor(s)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!shown) return null;

  const dismiss = () => { if (shown !== 'done') snooze(); setShown(null); };

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      if (next === 'on') setShown('done');
      else if (next === 'blocked') setShown('blocked');
    } catch {
      // Leave the strip up so they can try again.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="region" aria-label="Pop-up notifications" className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
      <div className="min-w-0 flex-1">
        {shown === 'ask' && (
          <>
            <p><strong>Turn on pop-up notifications</strong> to hear about new work and messages when this tab is in the background, you are in another app, or the website is closed.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={turnOn}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Turn on
              </button>
              <button type="button" onClick={dismiss} className="rounded-md px-3 py-1 font-medium text-emerald-900 hover:bg-emerald-100">Not now</button>
            </div>
          </>
        )}
        {shown === 'blocked' && (
          <p><strong>Pop-up notifications are blocked for this website.</strong> Click the icon to the left of the web address, set <strong>Notifications</strong> to Allow, then reload the page.</p>
        )}
        {shown === 'homescreen' && (
          <p><strong>To get pop-ups on iPhone / iPad:</strong> tap Share → &ldquo;Add to Home Screen&rdquo;, open the website from that icon, and turn pop-ups on there.</p>
        )}
        {shown === 'done' && (
          <p role="status"><strong>Pop-ups are on for this browser.</strong> To check, open the bell and press &ldquo;Send a test&rdquo;. No pop-up? On a Mac: System Settings → Notifications → your browser → Allow notifications, and turn Focus / Do Not Disturb off.</p>
        )}
      </div>
      {shown !== 'ask' && (
        <button type="button" onClick={dismiss} aria-label="Close" className="rounded p-1 text-emerald-800 hover:bg-emerald-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
