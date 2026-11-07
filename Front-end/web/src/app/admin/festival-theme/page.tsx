'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { FESTIVAL_THEMES } from '@/lib/festival/themes';
import { istInputToIso, isoToIstInput } from '@/lib/festival/istInput';
import { formatDateTimeIST } from '@/lib/datetime';
import FestivalOfferPanel from '@/components/admin/FestivalOfferPanel';

/**
 * Admin — festival theme (Diwali sparks, toran, fireworks, deal badges, countdown).
 *
 * One switch and a window in IST. The storefront hides the theme by itself once
 * the end time passes — no deploy and no need to come back and switch it off.
 * The theme never shows in the admin or staff panels, or on checkout.
 */

interface ThemeSettings {
  enabled: boolean;
  themeKey: string;
  startsAt: string | null;
  endsAt: string | null;
  live: boolean;
  updatedAt: string | null;
}

const label = 'block text-sm font-medium text-gray-700 mb-1';
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2';
const hint = 'mt-1 text-xs text-gray-500';

function statusText(s: ThemeSettings): string {
  if (s.live) return 'Showing on the website now';
  if (!s.enabled) return 'Off';
  if (s.startsAt && Date.parse(s.startsAt) > Date.now()) return `Starts ${formatDateTimeIST(s.startsAt)}`;
  if (s.endsAt && Date.parse(s.endsAt) <= Date.now()) return 'Ended — switched off automatically';
  return 'Off';
}

export default function AdminFestivalThemePage() {
  const [saved, setSaved] = useState<ThemeSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [themeKey, setThemeKey] = useState('diwali');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (t: ThemeSettings) => {
    setSaved(t);
    setEnabled(t.enabled);
    setThemeKey(t.themeKey || 'diwali');
    setStartsAt(isoToIstInput(t.startsAt));
    setEndsAt(isoToIstInput(t.endsAt));
  };

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; theme: ThemeSettings }>(API_ENDPOINTS.FESTIVAL_THEME_ADMIN);
      apply(res.theme);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load the festival settings');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setMsg(null);
    setError(null);
    const start = istInputToIso(startsAt);
    const end = istInputToIso(endsAt);
    if (start && end && Date.parse(end) <= Date.parse(start)) {
      setError('The end must be after the start.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiClient.put<{ success: boolean; theme: ThemeSettings }>(API_ENDPOINTS.FESTIVAL_THEME_ADMIN, {
        enabled, themeKey, startsAt: start, endsAt: end,
      });
      apply(res.theme);
      setMsg('Saved. The website updates within a minute.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Festival theme</h1>
      <p className="text-gray-600 mb-6">
        Festive look for the shop: sparks when someone adds to cart, fireworks when an order is
        confirmed, a toran along the top, &ldquo;Deal&rdquo; badges on sale items and an offer countdown.
        It switches itself off at the end time.
      </p>

      {saved && (
        <p className={`mb-6 inline-block rounded-full px-3 py-1 text-sm font-medium ${saved.live ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`} data-testid="festival-status">
          {statusText(saved)}
        </p>
      )}

      <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-6">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5" />
          <span className="font-medium">Festival theme on</span>
        </label>

        <div>
          <label className={label} htmlFor="fx-theme">Festival</label>
          <select id="fx-theme" className={input} value={themeKey} onChange={(e) => setThemeKey(e.target.value)}>
            {Object.values(FESTIVAL_THEMES).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="fx-start">Starts (IST)</label>
            <input id="fx-start" type="datetime-local" className={input} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            <p className={hint}>Leave empty to start as soon as you save.</p>
          </div>
          <div>
            <label className={label} htmlFor="fx-end">Ends (IST)</label>
            <input id="fx-end" type="datetime-local" className={input} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            <p className={hint}>The countdown counts to this time. Leave empty for no end (no countdown).</p>
          </div>
        </div>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {msg && <p className="text-sm text-green-700">{msg}</p>}

        <button onClick={save} disabled={saving} className="bg-blue-600 text-white rounded-lg px-5 py-2 font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <FestivalOfferPanel
        themeStartsAt={isoToIstInput(saved?.startsAt ?? null)}
        themeEndsAt={isoToIstInput(saved?.endsAt ?? null)}
      />
    </div>
  );
}
