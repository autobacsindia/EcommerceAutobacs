'use client';

import { useState } from 'react';
import {
  SHIPPING_CLASSES,
  SHIPPING_CLASS_LABELS,
  saveShippingClass,
  type ShippingClass,
} from '@/lib/shippingClass';

export const MAX_BULK_SHIPPING_CLASS = 200;

/** Sets one size class (or Automatic) on the ticked products. */
export default function ShippingClassBulkBar({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const [choice, setChoice] = useState<ShippingClass | 'auto'>('small');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (selectedIds.length === 0 && !message) return null;
  const tooMany = selectedIds.length > MAX_BULK_SHIPPING_CLASS;

  const apply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await saveShippingClass(selectedIds, choice);
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
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm" aria-label="Change size class for selected products">
      {selectedIds.length > 0 && (
        <>
          <span className="font-medium">{selectedIds.length} selected. Size class:</span>
          <select
            value={choice}
            onChange={(e) => { setChoice(e.target.value as ShippingClass | 'auto'); setMessage(null); }}
            className="rounded border bg-white px-3 py-1.5"
            aria-label="Size class to set"
          >
            {SHIPPING_CLASSES.map((c) => <option key={c} value={c}>{SHIPPING_CLASS_LABELS[c]}</option>)}
            <option value="auto">Automatic (from each product&apos;s size)</option>
          </select>
          <button
            type="button"
            onClick={apply}
            disabled={busy || tooMany}
            className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Applying…' : 'Set size class'}
          </button>
          {tooMany && <span className="text-red-700">Choose at most {MAX_BULK_SHIPPING_CLASS} at a time.</span>}
        </>
      )}
      {message && <span role="status" className={message.ok ? 'text-green-700' : 'text-red-700'}>{message.text}</span>}
    </div>
  );
}
