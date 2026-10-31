'use client';

import { useQuery } from '@tanstack/react-query';
import { BellOff, CheckCircle2, CircleHelp, RefreshCw, TriangleAlert } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { pushDeviceKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';

/**
 * Pop-up check — who gets pop-up notifications, on which browsers, and whether
 * they actually arrive. Read-only (GET /push/devices).
 *
 *   Working      the last pop-up sent to that browser was accepted
 *   Not tested   turned on, nothing sent to it yet
 *   Failing      the pop-up service refused it recently (removed after 3 in a row;
 *                it signs up again by itself the next time the panel opens there)
 *   No browser   that person never turned pop-ups on anywhere
 * "Working" means the pop-up service delivered it to the browser; whether the
 * computer showed it is only known on that computer ("Send me a test pop-up").
 */
type Device = {
  id: string; device: string; addedAt: string; lastSeenAt: string; lastWorkedAt: string | null;
  failures: number; lastError: string; health: 'working' | 'untested' | 'failing';
};
type Person = { id: string; name: string; team: string; isHead: boolean; devices: Device[] };
type Devices = { configured: boolean; staleDays: number; people: Person[]; truncated: boolean };

const HEALTH = {
  working: { label: 'Working', icon: CheckCircle2, cls: 'bg-green-100 text-green-800' },
  untested: { label: 'Not tested yet', icon: CircleHelp, cls: 'bg-gray-100 text-gray-700' },
  failing: { label: 'Failing', icon: TriangleAlert, cls: 'bg-amber-100 text-amber-800' },
} as const;

function DeviceRow({ d }: { d: Device }) {
  const h = HEALTH[d.health];
  const Icon = h.icon;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      <span className="font-medium text-gray-800">{d.device}</span>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${h.cls}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {h.label}
      </span>
      <span className="text-xs text-gray-500">
        {d.lastWorkedAt ? `last pop-up ${formatDateTimeIST(d.lastWorkedAt)}` : `turned on ${formatDateTimeIST(d.addedAt)}`}
        {' · '}panel last opened {formatDateTimeIST(d.lastSeenAt)}
      </span>
      {d.health === 'failing' && (
        <span className="w-full text-xs text-amber-800">
          Refused {d.failures} time{d.failures === 1 ? '' : 's'} in a row{d.lastError ? ` (${d.lastError})` : ''}. It signs up again by itself next time the panel opens on that browser.
        </span>
      )}
    </li>
  );
}

export default function PopUpCheckPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: pushDeviceKeys.all,
    queryFn: () => apiClient.get<Devices>('/push/devices'),
  });

  const people = data?.people ?? [];
  const none = people.filter((p) => !p.devices.length);
  const failing = people.filter((p) => p.devices.some((d) => d.health === 'failing'));
  const working = people.filter((p) => p.devices.some((d) => d.health === 'working'));
  // Nobody first: they are the ones to help.
  const sorted = [...people].sort((a, b) => Number(!!a.devices.length) - Number(!!b.devices.length) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="pn-title text-2xl text-gray-900">Pop-up check</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Who gets pop-up notifications for new messages and work, and on which browsers. Someone with no browser, or a failing one,
            should open the bell on their computer and press <strong>Turn on</strong> or <strong>Send me a test pop-up</strong> — it tells them what to fix.
          </p>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Could not load the list. Try Refresh.</p>}
      {data && !data.configured && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Pop-ups are not set up on the server (no push keys), so nobody gets them.</p>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-2xl font-bold text-gray-900">{working.length}</p><p className="text-sm text-gray-600">people with a working browser</p></div>
            <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-2xl font-bold text-gray-900">{failing.length}</p><p className="text-sm text-gray-600">people with a failing browser</p></div>
            <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-2xl font-bold text-gray-900">{none.length}</p><p className="text-sm text-gray-600">people who never turned pop-ups on</p></div>
          </div>

          <ul className="divide-y divide-gray-100 rounded-xl bg-white shadow-sm">
            {sorted.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">
                  {p.name} <span className="font-normal text-gray-500">· {p.team}{p.isHead ? ' head' : ''}</span>
                </p>
                {p.devices.length ? (
                  <ul className="mt-1">{p.devices.map((d) => <DeviceRow key={d.id} d={d} />)}</ul>
                ) : (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-gray-600">
                    <BellOff className="h-4 w-4 text-gray-400" aria-hidden="true" /> No browser — pop-ups were never turned on, or not for {data.staleDays} days.
                  </p>
                )}
              </li>
            ))}
          </ul>
          {data.truncated && <p className="text-xs text-gray-500">Showing the first 500 browsers.</p>}
        </>
      )}
    </div>
  );
}
