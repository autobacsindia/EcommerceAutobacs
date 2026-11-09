'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import type { FestivalOfferSetting } from '@/lib/festival/festivalOffer';
import {
  CUSTOM_PERCENT_ERROR,
  canChangeFestivalOffer,
  festivalSettingLabel,
  parseCustomPercent,
  saveFestivalOfferSetting,
  type FestivalOfferMode,
} from '@/lib/festival/festivalOfferSetting';

const OPTIONS: { mode: FestivalOfferMode; label: string; help: string }[] = [
  { mode: 'auto', label: 'Automatic', help: '2%, 3%, 5% or 10% by price, like the rest of the shop.' },
  { mode: 'none', label: 'No Diwali offer', help: 'The product sells at its normal price.' },
  { mode: 'custom', label: 'Custom %', help: 'Use your own percentage instead of the automatic one.' },
];

/**
 * The Diwali offer for one product. Saves on its own button because it goes through
 * its own validated, audited endpoint rather than the multipart product save.
 */
export default function FestivalOfferSettingPanel({
  productId,
  setting,
}: {
  productId: string;
  setting: FestivalOfferSetting | null | undefined;
}) {
  const { user } = useAuth();
  const canEdit = canChangeFestivalOffer(user);
  const [saved, setSaved] = useState<FestivalOfferSetting | null>(setting ?? null);
  const [mode, setMode] = useState<FestivalOfferMode>(setting?.mode ?? 'auto');
  const [percentText, setPercentText] = useState(setting?.percent != null ? String(setting.percent) : '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // The product loads after first render; adopt its setting when it arrives.
  useEffect(() => {
    setSaved(setting ?? null);
    setMode(setting?.mode ?? 'auto');
    setPercentText(setting?.percent != null ? String(setting.percent) : '');
  }, [setting]);

  if (!canEdit) {
    return (
      <section className="mt-6 rounded-lg border border-gray-200 p-4" aria-label="Diwali offer">
        <h3 className="font-semibold text-gray-900">Diwali offer</h3>
        <p className="mt-1 text-sm text-gray-600">
          {festivalSettingLabel(saved)}. Only an admin or the marketing team can change this.
        </p>
      </section>
    );
  }

  const percent = mode === 'custom' ? parseCustomPercent(percentText) : null;
  const percentInvalid = mode === 'custom' && percent === null;

  const save = async () => {
    if (percentInvalid) {
      setMessage({ ok: false, text: CUSTOM_PERCENT_ERROR });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await saveFestivalOfferSetting([productId], mode, percent);
      const next: FestivalOfferSetting | null = mode === 'auto'
        ? null
        : mode === 'none' ? { mode: 'none' } : { mode: 'custom', percent: percent as number };
      setSaved(next);
      setMessage({ ok: true, text: `Saved: ${festivalSettingLabel(next)}` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not save. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50/40 p-4" aria-label="Diwali offer">
      <h3 className="font-semibold text-gray-900">Diwali offer</h3>
      <p className="mt-1 text-sm text-gray-600">
        Applies to all models of this product, only while the Diwali discount is switched on. Saved separately from the product.
      </p>
      <div className="mt-3 space-y-2">
        {OPTIONS.map((o) => (
          <div key={o.mode} className="text-sm">
            <label className="inline-flex items-center gap-2 font-medium text-gray-900">
              <input
                type="radio"
                name="festival-offer-mode"
                checked={mode === o.mode}
                onChange={() => { setMode(o.mode); setMessage(null); }}
              />
              {o.label}
            </label>
            <span className="ml-2 text-gray-600">{o.help}</span>
          </div>
        ))}
      </div>
      {mode === 'custom' && (
        <label className="mt-3 block text-sm">
          <span className="font-medium text-gray-900">Percentage off (1 to 30)</span>
          <input
            type="text"
            inputMode="numeric"
            value={percentText}
            onChange={(e) => { setPercentText(e.target.value); setMessage(null); }}
            // This panel sits inside the product form; Enter must not save the product.
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            aria-invalid={percentInvalid}
            className="mt-1 block w-24 rounded border border-gray-300 px-3 py-2"
          />
        </label>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Apply Diwali offer'}
        </button>
        {message && <span role="status" className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-700'}`}>{message.text}</span>}
      </div>
    </section>
  );
}
