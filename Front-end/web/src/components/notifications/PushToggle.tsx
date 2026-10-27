'use client';

import { useEffect, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { disablePush, enablePush, needsHomeScreen, pushState, sendTestPush, type PushState } from '@/lib/push';

const errorText = (e: unknown) => (e as { rawData?: { message?: string } })?.rawData?.message || (e as Error)?.message || 'That did not work.';

/**
 * "Pop-ups on this device": turn push notifications on or off, and send a test.
 * Lives in the bell panel. Hidden when the server has no push keys.
 */
export default function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    pushState().then((s) => { if (alive) setState(s); }).catch(() => { if (alive) setState('off'); });
    return () => { alive = false; };
  }, []);

  const run = async (fn: () => Promise<PushState | void>, done?: string) => {
    setBusy(true);
    setNote('');
    try {
      const next = await fn();
      if (next) setState(next);
      if (done) setNote(done);
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === null || state === 'unavailable') return null;
  return (
    <div className="px-3 py-2 text-xs text-gray-600">
      <div className="flex flex-wrap items-center gap-2">
        <BellRing className="h-3.5 w-3.5 text-gray-500" />
        <span className="font-medium text-gray-800">Pop-ups on this device</span>
        {state === 'on' && <span className="rounded-full bg-green-100 px-1.5 py-0.5 font-medium text-green-800">On</span>}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
      {state === 'off' && (
        <div className="mt-1.5">
          <p>Get a pop-up for new messages and new work, even when this website is closed.</p>
          <button type="button" disabled={busy} onClick={() => run(enablePush, 'Done — you will get pop-ups on this device.')}
            className="mt-1.5 rounded-md bg-emerald-700 px-2.5 py-1 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            Turn on
          </button>
        </div>
      )}
      {state === 'on' && (
        <div className="mt-1.5 flex gap-2">
          <button type="button" disabled={busy} onClick={() => run(async () => {
            const { sent } = await sendTestPush();
            // The server reached no device: its saved sign-up is gone (browser data cleared, etc.).
            if (!sent) throw new Error('This device could not be reached. Click "Turn off", then "Turn on" again.');
          }, 'Sent. No pop-up within a few seconds? Your computer is blocking it — on a Mac: System Settings → Notifications → Google Chrome → Allow notifications (and turn Focus / Do Not Disturb off).')}
            className="rounded-md border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Send a test</button>
          <button type="button" disabled={busy} onClick={() => run(() => disablePush({ remember: true }))}
            className="rounded-md border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Turn off</button>
        </div>
      )}
      {state === 'blocked' && (
        <p className="mt-1">Notifications are blocked for this site. Click the lock icon next to the web address, allow <strong>Notifications</strong>, then reload.</p>
      )}
      {state === 'unsupported' && (
        <p className="mt-1">
          {needsHomeScreen()
            ? 'On iPhone / iPad: tap Share → "Add to Home Screen", open the website from that icon, then turn pop-ups on here.'
            : 'This browser cannot show pop-up notifications. Use Chrome, Edge, Firefox or Safari.'}
        </p>
      )}
      {note && <p role="status" className="mt-1 text-gray-700">{note}</p>}
    </div>
  );
}
