'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { MapPin, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import type { HrSettings, HrSettingsInput, Shift, WorkSite } from '@/lib/hr/types';
import StatusChip from './StatusChip';
import { useHrList } from './useHrList';
import { HrEmpty, HrErrorState, HrLoadMore, HrLoading, HrPageHeader, hrBtnGhost, hrBtnPrimary, hrCard, hrInput } from './HrStates';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function AddSiteForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', address: '', lat: '', lng: '', radiusM: '150' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => hrApi.createSite({ name: f.name.trim(), address: f.address.trim(), lat: Number(f.lat), lng: Number(f.lng), radiusM: Number(f.radiusM) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: hrKeys.sites() }); onDone(); },
    onError: (err) => setError(describeHrError(err).message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setError('Give the site a name.'); return; }
    if (!Number.isFinite(Number(f.lat)) || !Number.isFinite(Number(f.lng)) || !f.lat || !f.lng) { setError('Add the latitude and longitude (copy them from Google Maps).'); return; }
    setError(null);
    save.mutate();
  };
  const input = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} className={hrInput} {...props} />
    </label>
  );
  return (
    <form onSubmit={submit} className={`${hrCard} mb-3 grid gap-3 p-4 sm:grid-cols-2`}>
      {input('name', 'Site name')}
      {input('address', 'Address')}
      {input('lat', 'Latitude', { inputMode: 'decimal', placeholder: '12.9716' })}
      {input('lng', 'Longitude', { inputMode: 'decimal', placeholder: '77.5946' })}
      {input('radiusM', 'Clock-in allowed within (metres)', { inputMode: 'numeric' })}
      <div className="flex items-end gap-2">
        <button type="submit" className={hrBtnPrimary} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Add site'}</button>
        <button type="button" className={hrBtnGhost} onClick={onDone} disabled={save.isPending}>Cancel</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
    </form>
  );
}

function Sites() {
  const [adding, setAdding] = useState(false);
  const list = useHrList<WorkSite>(hrKeys.sites(), (cursor) => hrApi.listSites(cursor));
  const unavailable = list.isError;
  return (
    <section aria-labelledby="hr-sites" className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="hr-sites" className="text-lg font-bold text-gray-900">Work sites</h2>
        {!adding && !unavailable && <button type="button" className={hrBtnGhost} onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Add site</button>}
      </div>
      {adding && <AddSiteForm onDone={() => setAdding(false)} />}
      {list.isError ? <HrErrorState error={list.error} /> : list.isPending ? <HrLoading /> : !list.rows.length ? (
        <HrEmpty title="No work sites yet">Add the showroom and workshop so staff can clock in there.</HrEmpty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.rows.map((s) => (
            <li key={s.id} className={`${hrCard} p-4`}>
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold text-gray-900"><MapPin className="h-4 w-4 text-emerald-700" aria-hidden="true" /> {s.name}</p>
                <StatusChip tone={s.active ? 'ok' : 'muted'}>{s.active ? 'In use' : 'Off'}</StatusChip>
              </div>
              {s.address && <p className="mt-1 text-sm text-gray-600">{s.address}</p>}
              <p className="mt-2 text-sm text-gray-700">Clock-in allowed within <strong>{s.radiusM} m</strong></p>
            </li>
          ))}
        </ul>
      )}
      <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
      <p className="mt-2 text-xs text-gray-500">Staff can only clock in inside the circle. Field staff can be allowed anywhere; their punches are marked &ldquo;outside site&rdquo;.</p>
    </section>
  );
}

function Shifts() {
  const list = useHrList<Shift>(hrKeys.shifts(), (cursor) => hrApi.listShifts(cursor));
  return (
    <section aria-labelledby="hr-shifts" className="mb-8">
      <h2 id="hr-shifts" className="mb-2 text-lg font-bold text-gray-900">Shifts</h2>
      {list.isError ? <HrErrorState error={list.error} /> : list.isPending ? <HrLoading /> : !list.rows.length ? (
        <HrEmpty title="No shifts yet">Until one is added, everyone works 10:00 am – 7:00 pm with Sunday off.</HrEmpty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.rows.map((s) => (
            <li key={s.id} className={`${hrCard} p-4 text-sm`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-gray-900">{s.name}</p>
                <span className="flex gap-1">{s.isDefault && <StatusChip tone="info">Default</StatusChip>}{!s.active && <StatusChip tone="muted">Off</StatusChip>}</span>
              </div>
              <p className="mt-1 text-gray-700">{s.start} – {s.end} · {s.graceMinutes} min grace</p>
              <p className="text-gray-500">Weekly off: {s.weeklyOff.length ? s.weeklyOff.map((d) => WEEKDAYS[d]).join(', ') : 'none'}</p>
            </li>
          ))}
        </ul>
      )}
      <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
      <p className="mt-2 text-xs text-gray-500">Grace, half day, overtime and marks are set on <Link href="/hr/rules" className="font-semibold text-emerald-700 underline">Attendance rules</Link>.</p>
    </section>
  );
}

const NUMBER_FIELDS: { key: 'maxFaceAttempts' | 'offlineMaxHours' | 'gpsMaxAccuracyM' | 'payday'; label: string; min: number; max: number }[] = [
  { key: 'maxFaceAttempts', label: 'Face tries before HR review', min: 1, max: 10 },
  { key: 'offlineMaxHours', label: 'Offline clock-in allowed for (hours)', min: 1, max: 168 },
  { key: 'gpsMaxAccuracyM', label: 'Reject GPS weaker than (metres)', min: 10, max: 1000 },
  { key: 'payday', label: 'Payday (day of month)', min: 1, max: 28 },
];

function SettingsForm({ settings }: { settings: HrSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Required<HrSettingsInput>>({
    maxFaceAttempts: settings.maxFaceAttempts, offlineMaxHours: settings.offlineMaxHours, gpsMaxAccuracyM: settings.gpsMaxAccuracyM,
    payday: settings.payday, leaveHeadStep: settings.leaveHeadStep, includeIncentives: settings.includeIncentives,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: (input: HrSettingsInput) => hrApi.updateSettings(settings.rev, input),
    onSuccess: (res) => { qc.setQueryData(hrKeys.settings(), res); setMsg({ ok: true, text: 'Saved.' }); },
    onError: (err) => {
      const v = describeHrError(err);
      setMsg({ ok: false, text: v.message });
      if (v.kind === 'conflict') qc.invalidateQueries({ queryKey: hrKeys.settings() });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const changed: HrSettingsInput = {};
    (Object.keys(f) as (keyof typeof f)[]).forEach((k) => { if (f[k] !== settings[k]) (changed as Record<string, unknown>)[k] = f[k]; });
    if (!Object.keys(changed).length) { setMsg({ ok: true, text: 'Nothing has changed.' }); return; }
    save.mutate(changed);
  };
  return (
    <form onSubmit={submit} className={`${hrCard} grid gap-4 p-4 sm:grid-cols-2`}>
      {NUMBER_FIELDS.map((n) => (
        <label key={n.key} className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">{n.label}</span>
          <input
            type="number" min={n.min} max={n.max} value={f[n.key]} className={hrInput}
            onChange={(e) => setF((p) => ({ ...p, [n.key]: Number(e.target.value) }))}
          />
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.leaveHeadStep} onChange={(e) => setF((p) => ({ ...p, leaveHeadStep: e.target.checked }))} />
        Team head approves leave before HR
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.includeIncentives} onChange={(e) => setF((p) => ({ ...p, includeIncentives: e.target.checked }))} />
        Show approved Roav Points on payslips
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className={hrBtnPrimary} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

function Settings() {
  const q = useQuery({ queryKey: hrKeys.settings(), queryFn: () => hrApi.getSettings(), retry: false });
  return (
    <section aria-labelledby="hr-settings">
      <h2 id="hr-settings" className="mb-2 text-lg font-bold text-gray-900">HR settings</h2>
      {q.isPending ? <HrLoading /> : q.isError ? <HrErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        // Remount on a new rev so the form shows what the server now holds.
        <SettingsForm key={q.data.settings.rev} settings={q.data.settings} />
      )}
      <p className="mt-2 text-xs text-gray-500">PF, ESI and professional-tax rates are set with the accountant and are not changed here.</p>
    </section>
  );
}

export default function SitesAndSettings() {
  return (
    <div className="max-w-5xl">
      <HrPageHeader title="Work sites & settings" />
      <Sites />
      <Shifts />
      <Settings />
    </div>
  );
}
