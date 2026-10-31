'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BellRing, CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { disablePush, enablePush, needsHomeScreen, pushState, testThisBrowser, type PushState, type TestOutcome } from '@/lib/push';
import { allowSteps, detectBrowser, notReceivedHelp, osSteps, subscribeFailHelp } from '@/lib/pushHelp';

const errorText = (e: unknown) => (e as { rawData?: { message?: string } })?.rawData?.message || (e as Error)?.message || 'That did not work.';

type Note = { tone: 'ok' | 'warn'; text: string; more?: string } | null;

/**
 * "Pop-ups on this browser": the status of THIS browser in plain words, the one
 * thing to do next, and a test that says how far a pop-up got. Lives in the
 * bell panel. Hidden when the server has no push keys.
 *
 * The test matters most: "the browser allows it" is all a website can see, yet
 * the computer can still hide every pop-up (Focus, Do not disturb, the browser
 * switched off in the computer's settings). The worker in the browser reports
 * back when the test arrives, so "arrived, but you saw nothing" points at the
 * computer, and "never arrived" points at the browser or the network.
 */
export default function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const info = useMemo(() => detectBrowser(), []);
  const isAdmin = (usePathname() || '').startsWith('/admin');

  useEffect(() => {
    let alive = true;
    pushState().then((s) => { if (alive) setState(s); }).catch(() => { if (alive) setState('off'); });
    return () => { alive = false; };
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    try {
      const next = await enablePush();
      setState(next);
      if (next === 'on') setNote({ tone: 'ok', text: 'Done — pop-ups are on for this browser. Press "Send me a test pop-up" to check.' });
      else if (next === 'off') setNote({ tone: 'warn', text: 'The browser did not say Allow. Press Turn on again and choose Allow.' });
    } catch {
      setNote({ tone: 'warn', text: subscribeFailHelp(info.browser) });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setNote(null);
    try {
      const outcome: TestOutcome = await testThisBrowser();
      setNote(
        outcome === 'received' ? {
          tone: 'ok',
          text: 'This browser received the test pop-up.',
          more: `Did not see it? Your computer is hiding pop-ups. ${osSteps(info.os, info.browser)}`,
        }
          : outcome === 'not-received' ? { tone: 'warn', text: 'The test did not reach this browser.', more: notReceivedHelp(info.browser) }
            : outcome === 'refused' ? { tone: 'warn', text: 'The pop-up service refused this browser even after signing it up again.', more: subscribeFailHelp(info.browser) }
              : { tone: 'warn', text: 'The pop-up service is having trouble right now. Try again in a minute.' },
      );
    } catch (e) {
      setNote({ tone: 'warn', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setNote(null);
    try {
      setState(await disablePush({ remember: true }));
    } finally {
      setBusy(false);
    }
  };

  if (state === null || state === 'unavailable') return null;
  const chip = state === 'on' ? ['ON', 'bg-green-100 text-green-800']
    : state === 'blocked' ? ['Blocked', 'bg-red-100 text-red-800']
      : state === 'off' ? ['OFF', 'bg-gray-100 text-gray-700'] : null;
  const button = 'rounded-md border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

  return (
    <div className="px-3 py-2 text-xs text-gray-600">
      <div className="flex flex-wrap items-center gap-2">
        <BellRing className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
        <span className="font-medium text-gray-800">Pop-ups on this browser</span>
        {chip && <span className={`rounded-full px-1.5 py-0.5 font-semibold ${chip[1]}`}>{chip[0]}</span>}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Working" />}
      </div>
      {state !== 'unsupported' && <p className="mt-0.5 text-gray-500">{info.label}</p>}

      {state === 'off' && (
        <div className="mt-1.5">
          <p>Get a pop-up for new messages and new work, even when this website is closed.</p>
          <button type="button" disabled={busy} onClick={turnOn}
            className="mt-1.5 rounded-md bg-emerald-700 px-2.5 py-1 font-semibold text-[#fff] hover:bg-emerald-800 disabled:opacity-50">
            Turn on
          </button>
        </div>
      )}
      {state === 'on' && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={test} className={button}>Send me a test pop-up</button>
          <button type="button" disabled={busy} onClick={turnOff} className={button}>Turn off</button>
        </div>
      )}
      {state === 'blocked' && (
        <div className="mt-1 space-y-1">
          <p><strong className="text-gray-800">Pop-ups are blocked for this website in {info.label}.</strong> {allowSteps(info.browser)}</p>
          <p>In a private / incognito window pop-ups cannot work — open the panel in a normal window. On an office-managed computer, ask whoever manages it to allow notifications for autobacsindia.com.</p>
        </div>
      )}
      {state === 'unsupported' && (
        <p className="mt-1">
          {needsHomeScreen()
            ? 'On iPhone / iPad: tap Share → "Add to Home Screen", open the website from that icon, then turn pop-ups on here.'
            : 'This browser cannot show pop-up notifications. Use Chrome, Edge, Firefox or Safari.'}
        </p>
      )}
      {note && (
        <div role="status" className={`mt-1.5 flex gap-1.5 rounded-md px-2 py-1.5 ${note.tone === 'ok' ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
          {note.tone === 'ok'
            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <div>
            <p className="font-medium">{note.text}</p>
            {note.more && <p className="mt-0.5">{note.more}</p>}
          </div>
        </div>
      )}
      {isAdmin && (
        <Link href="/admin/pop-ups" className="mt-1.5 inline-block font-medium text-blue-700 hover:underline">
          Who has pop-ups working →
        </Link>
      )}
    </div>
  );
}
