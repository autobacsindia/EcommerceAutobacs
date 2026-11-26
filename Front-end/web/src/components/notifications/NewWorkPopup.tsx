'use client';

/**
 * The "new work" pop-up inside the panel: a card in the corner the moment
 * someone gives you a task or adds you to a project — "Vicky added you to a
 * project · Vicky's Hilux" — with the "new work" sound. Order follow-ups use the
 * same card: a step due (followup_due) or late and escalated to a head / admin
 * (followup_escalated, red), each with an "Open order" button.
 *
 * ── Where it comes from ─────────────────────────────────────────────────────
 * The bell's poll (/notifications/summary, every 20 s; hooks/queries/
 * useNotifications.ts) carries `alerts`: the newest unread new-task and
 * added-to-project Inbox lines of the last day. No second poll, no new socket.
 * With the panel closed, the phone/computer notification (pushService) does
 * this job; the line also stays in the Inbox either way.
 *
 * ── Once per device ─────────────────────────────────────────────────────────
 * Ids shown are remembered in localStorage, so a card does not come back on
 * every page or every poll, and closing it in one tab closes it in the others
 * (the `storage` event). Storage can be unavailable (private window, blocked
 * site data): then cards still show, and only "remembered" is lost.
 *
 * The sound plays only when a NEW card appears in a tab the person is looking
 * at: in a hidden tab the computer's own notification already made its sound.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, FolderKanban, TriangleAlert, UserPlus, X } from 'lucide-react';
import { useWaitingWork, type WorkAlert } from '@/hooks/queries/useNotifications';
import { alert as playAlert } from '@/lib/notificationChime';

export const SEEN_KEY = 'roavion-work-alerts-seen';
const SEEN_MAX = 200;
/** Cards on screen at once; the rest wait their turn (and are all in the Inbox). */
export const SHOWN_MAX = 3;

function readSeen(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeen(list: string[]) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_MAX)));
  } catch {
    // Not remembered: the card may show again on the next page. Harmless.
  }
}

function headline(a: WorkAlert) {
  switch (a.kind) {
    case 'project_added': return `${a.by || 'Someone'} added you to a project`;
    case 'followup_due': return 'Order follow-up due';
    case 'followup_escalated': return 'Late order follow-up';
    default: return `New task from ${a.by || 'your team'}`;
  }
}

/** Icon, colours and button per kind. */
function look(kind: WorkAlert['kind']) {
  if (kind === 'followup_escalated') {
    return { Icon: TriangleAlert, card: 'border-red-200', badge: 'bg-red-100 text-red-700', button: 'bg-red-600 hover:bg-red-700', action: 'Open order' };
  }
  if (kind === 'followup_due') {
    return { Icon: AlarmClock, card: 'border-amber-200', badge: 'bg-amber-100 text-amber-800', button: 'bg-blue-600 hover:bg-blue-700', action: 'Open order' };
  }
  return {
    Icon: kind === 'project_added' ? FolderKanban : UserPlus,
    card: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
    button: 'bg-blue-600 hover:bg-blue-700',
    action: kind === 'project_added' ? 'Open project' : 'Open task',
  };
}

/** "due 2026-11-25" → "Due 25 Nov"; anything else as written. */
function detail(text: string) {
  return text.replace(/(due|deadline) (\d{4})-(\d{2})-(\d{2})/g, (_m, what: string, y: string, mo: string, d: string) => {
    const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    const label = day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${what === 'due' ? 'Due' : 'deadline'} ${label}`;
  });
}

export default function NewWorkPopup() {
  const { data } = useWaitingWork();
  const alerts = useMemo(() => data?.alerts ?? [], [data]);
  // null until mounted: the server render never shows a card (no hydration mismatch).
  const [seen, setSeen] = useState<string[] | null>(null);
  const rang = useRef(new Set<string>());

  useEffect(() => {
    setSeen(readSeen());
    const onStorage = (e: StorageEvent) => { if (e.key === SEEN_KEY) setSeen(readSeen()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const showing = useMemo(
    () => (seen ? alerts.filter((a) => !seen.includes(a.id)).slice(0, SHOWN_MAX) : []),
    [alerts, seen],
  );

  useEffect(() => {
    const fresh = showing.filter((a) => !rang.current.has(a.id));
    if (!fresh.length) return;
    fresh.forEach((a) => rang.current.add(a.id));
    if (document.visibilityState === 'visible') playAlert();
  }, [showing]);

  const close = (id: string) => {
    const next = [...readSeen().filter((x) => x !== id), id];
    writeSeen(next);
    setSeen(next);
  };

  if (!showing.length) return null;
  return (
    <div
      role="region"
      aria-label="New work"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {showing.map((a) => {
        const { Icon, card, badge, button, action } = look(a.kind);
        return (
          <div key={a.id} role="status" className={`pointer-events-auto rounded-xl border ${card} bg-white p-3 shadow-lg`}>
            <div className="flex items-start gap-2.5">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${badge}`}>
                <Icon aria-hidden className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{headline(a)}</p>
                <p className="truncate text-sm text-gray-800">{a.title}</p>
                {a.text && <p className="truncate text-xs text-gray-500">{detail(a.text)}</p>}
                <Link
                  href={a.href}
                  onClick={() => close(a.id)}
                  className={`mt-2 inline-flex rounded-lg px-3 py-1 text-sm font-semibold text-white ${button}`}
                >
                  {action}
                </Link>
              </div>
              <button
                type="button"
                onClick={() => close(a.id)}
                aria-label={`Close: ${headline(a)}`}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
