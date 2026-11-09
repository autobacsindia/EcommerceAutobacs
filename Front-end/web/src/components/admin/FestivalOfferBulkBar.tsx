'use client';

import { useState } from 'react';
import {
  CUSTOM_PERCENT_ERROR,
  parseCustomPercent,
  saveFestivalOfferSetting,
  type FestivalOfferMode,
} from '@/lib/festival/festivalOfferSetting';

export const MAX_BULK_FESTIVAL_PRODUCTS = 200;

/** Applies one Diwali offer setting to the ticked products. */
export default function FestivalOfferBulkBar({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<FestivalOfferMode>('none');
  const [percentText, setPercentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (selectedIds.length === 0 && !message) return null;
  const tooMany = selectedIds.length > MAX_BULK_FESTIVAL_PRODUCTS;

  const apply = async () => {
    const percent = mode === 'custom' ? parseCustomPercent(percentText) : null;
    if (mode === 'custom' && percent === null) {
      setMessage({ ok: false, text: CUSTOM_PERCENT_ERROR });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await saveFestivalOfferSetting(selectedIds, mode, percent);
      const parts = [`${res.updated} updated`];
      if (res.unchanged) parts.push(`${res.unchanged} already set`);
      if (res.notFound.length) parts.push(`${res.notFound.length} could not be found`);
      setMessage({ ok: res.notFound.length === 0, text: parts.join(', ') });
      onDone();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not save. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm" aria-label="Change Diwali offer for selected products">
      {selectedIds.length > 0 && (
        <>
          <span className="font-medium">{selectedIds.length} selected. Diwali offer:</span>
          <select
            value={mode}
            onChange={(e) => { setMode(e.target.value as FestivalOfferMode); setMessage(null); }}
            className="rounded border bg-white px-3 py-1.5"
            aria-label="Diwali offer setting"
          >
            <option value="auto">Automatic</option>
            <option value="none">No Diwali offer</option>
            <option value="custom">Custom %</option>
          </select>
          {mode === 'custom' && (
            <input
              type="text"
              inputMode="numeric"
              placeholder="1 to 30"
              aria-label="Custom percentage"
              value={percentText}
              onChange={(e) => { setPercentText(e.target.value); setMessage(null); }}
              className="w-20 rounded border px-2 py-1.5"
            />
          )}
          <button
            type="button"
            onClick={apply}
            disabled={busy || tooMany}
            className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
          {tooMany && <span className="text-red-700">Choose at most {MAX_BULK_FESTIVAL_PRODUCTS} at a time.</span>}
        </>
      )}
      {message && <span role="status" className={message.ok ? 'text-green-700' : 'text-red-700'}>{message.text}</span>}
    </div>
  );
}
