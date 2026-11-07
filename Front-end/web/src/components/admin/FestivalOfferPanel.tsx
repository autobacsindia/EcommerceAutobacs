'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { istInputToIso, isoToIstInput } from '@/lib/festival/istInput';
import { formatDateTimeIST } from '@/lib/datetime';
import type { FestivalOfferTier } from '@/lib/festival/festivalOffer';

/**
 * Admin — the Diwali PRICE offer switch (separate from the decoration above it).
 *
 * Changes what customers are charged, so it has its own switch: turning it off stops
 * the discount on the very next cart, even while the theme stays on. The tier
 * percentages are fixed in code (shown read-only) so a typo here can never misprice
 * the catalogue.
 */

interface OfferSettings {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  live: boolean;
  tiers: FestivalOfferTier[];
  updatedAt: string | null;
}

const label = 'block text-sm font-medium text-gray-700 mb-1';
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2';
const hint = 'mt-1 text-xs text-gray-500';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/** Plain-words description of each tier, e.g. "Below ₹50,000 → 10% off". */
export function describeTiers(tiers: FestivalOfferTier[]): string[] {
  const sorted = [...tiers].sort((a, b) => a.minPaise - b.minPaise);
  return sorted.map((t, i) => {
    const next = sorted[i + 1];
    if (t.minPaise <= 0 && next) return `Below ${rupees(next.minPaise)} → ${t.percent}% off`;
    // A tier starting one paisa above a round figure reads as "above" that figure.
    const from = t.minPaise % 100 === 1 ? `Above ${rupees(t.minPaise - 1)}` : rupees(t.minPaise);
    if (!next) return `${from} → ${t.percent}% off`;
    return `${from}${t.minPaise % 100 === 1 ? ' up' : ''} to ${rupees(next.minPaise - 1)} → ${t.percent}% off`;
  });
}

function statusText(s: OfferSettings): string {
  if (s.live) return 'Discount is ON — customers are paying offer prices now';
  if (!s.enabled) return 'Off — normal prices';
  if (s.startsAt && Date.parse(s.startsAt) > Date.now()) return `Starts ${formatDateTimeIST(s.startsAt)}`;
  if (s.endsAt && Date.parse(s.endsAt) <= Date.now()) return 'Ended — switched off automatically';
  return 'Off — normal prices';
}

export default function FestivalOfferPanel({
  themeStartsAt,
  themeEndsAt,
}: {
  /** The theme's dates (IST input format), offered as a one-click copy. */
  themeStartsAt?: string;
  themeEndsAt?: string;
}) {
  const [saved, setSaved] = useState<OfferSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (o: OfferSettings) => {
    setSaved(o);
    setEnabled(o.enabled);
    setStartsAt(isoToIstInput(o.startsAt));
    setEndsAt(isoToIstInput(o.endsAt));
  };

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; offer: OfferSettings }>(API_ENDPOINTS.FESTIVAL_OFFER_ADMIN);
      apply(res.offer);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load the Diwali discount settings');
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
      const res = await apiClient.put<{ success: boolean; offer: OfferSettings }>(API_ENDPOINTS.FESTIVAL_OFFER_ADMIN, {
        enabled, startsAt: start, endsAt: end,
      });
      apply(res.offer);
      setMsg('Saved. Checkout uses the new setting straight away; product pages update within a minute.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-10" data-testid="festival-offer-panel">
      <h2 className="text-2xl font-bold mb-2">Diwali discount (prices)</h2>
      <p className="text-gray-600 mb-4">
        Takes money off every product automatically. This is separate from the festive look above —
        switch this off and prices go back to normal on the next cart, even if the theme stays on.
        Not used for quotations or orders made from the sales panel.
      </p>

      {saved && (
        <>
          <p className={`mb-4 inline-block rounded-full px-3 py-1 text-sm font-medium ${saved.live ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`} data-testid="festival-offer-status">
            {statusText(saved)}
          </p>
          <ul className="mb-4 list-disc pl-5 text-sm text-gray-700" data-testid="festival-offer-tiers">
            {describeTiers(saved.tiers).map((t) => <li key={t}>{t}</li>)}
          </ul>
          <p className="mb-6 text-xs text-gray-500">
            An extra discount on top of each product&apos;s current price (after any sale it already has). Example:
            M.R.P. ₹1,40,625 → ₹1,12,500 (−20%) → Diwali 3% → ₹1,09,125. The % is picked from the current price.
            Prices are rounded down to whole rupees.
          </p>
        </>
      )}

      <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-6">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5" />
          <span className="font-medium">Diwali discount on</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="fo-start">Starts (IST)</label>
            <input id="fo-start" type="datetime-local" className={input} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            <p className={hint}>Leave empty to start as soon as you save.</p>
          </div>
          <div>
            <label className={label} htmlFor="fo-end">Ends (IST)</label>
            <input id="fo-end" type="datetime-local" className={input} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            <p className={hint}>Prices go back to normal by themselves at this time.</p>
          </div>
        </div>

        {(themeStartsAt || themeEndsAt) && (
          <button
            type="button"
            onClick={() => { setStartsAt(themeStartsAt || ''); setEndsAt(themeEndsAt || ''); }}
            className="text-sm text-blue-700 underline"
          >
            Use the same dates as the festival theme (countdown)
          </button>
        )}

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {msg && <p className="text-sm text-green-700">{msg}</p>}

        <button onClick={save} disabled={saving} className="bg-blue-600 text-white rounded-lg px-5 py-2 font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save discount'}
        </button>
      </div>
    </section>
  );
}
