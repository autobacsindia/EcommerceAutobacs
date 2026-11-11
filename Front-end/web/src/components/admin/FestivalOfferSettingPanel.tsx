'use client';

import { useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAuth } from '@/context/AuthContext';
import {
  applyFestivalOffer,
  resolveFestivalSetting,
  type FestivalOfferSetting,
  type FestivalOfferTier,
  type FestivalVariantSetting,
} from '@/lib/festival/festivalOffer';
import {
  CUSTOM_PERCENT_ERROR,
  canChangeFestivalOffer,
  festivalSettingLabel,
  parseCustomPercent,
  saveFestivalOfferSetting,
  saveProductFestivalOffer,
  variantChoiceFromSetting,
  type FestivalOfferMode,
  type FestivalVariantMode,
} from '@/lib/festival/festivalOfferSetting';

const OPTIONS: { mode: FestivalOfferMode; label: string; help: string }[] = [
  { mode: 'auto', label: 'Automatic', help: '2%, 3%, 5% or 10% by price, like the rest of the shop.' },
  { mode: 'none', label: 'No Diwali offer', help: 'The product sells at its normal price.' },
  { mode: 'custom', label: 'Custom %', help: 'Use your own percentage instead of the automatic one.' },
];

const MODEL_OPTIONS: { mode: FestivalVariantMode; label: string }[] = [
  { mode: 'inherit', label: 'Same as product' },
  { mode: 'auto', label: 'Automatic (by this model’s price)' },
  { mode: 'none', label: 'No Diwali offer' },
  { mode: 'custom', label: 'Custom %' },
];

/** A saved model of this product (has an id), with the price typed in the editor. */
export interface FestivalPanelModel { _id: string; label: string; price: number }

interface ModelRow { mode: FestivalVariantMode; percentText: string }

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** The stored setting the admin's current choice would save, for the preview column. */
function rowToEntry(id: string, row: ModelRow): FestivalVariantSetting | null {
  if (row.mode === 'inherit') return null;
  if (row.mode === 'custom') {
    const p = parseCustomPercent(row.percentText);
    return { variantId: id, mode: 'custom', percent: p ?? -1 };
  }
  return { variantId: id, mode: row.mode };
}

/**
 * The Diwali offer for one product — and, for a product with models, for each model.
 * Saves on its own button through its own validated, audited endpoint (not the
 * multipart product save). The "Customer pays" column is a preview using the shop's
 * tier ladder from the server; the server recomputes every price it charges.
 */
export default function FestivalOfferSettingPanel({
  productId,
  setting,
  variantSettings,
  models = [],
  hasUnsavedModels = false,
}: {
  productId: string;
  setting: FestivalOfferSetting | null | undefined;
  variantSettings?: FestivalVariantSetting[] | null;
  models?: FestivalPanelModel[];
  hasUnsavedModels?: boolean;
}) {
  const { user } = useAuth();
  const canEdit = canChangeFestivalOffer(user);
  const [saved, setSaved] = useState<FestivalOfferSetting | null>(setting ?? null);
  const [savedEntries, setSavedEntries] = useState<FestivalVariantSetting[]>(variantSettings ?? []);
  const [mode, setMode] = useState<FestivalOfferMode>(setting?.mode ?? 'auto');
  const [percentText, setPercentText] = useState(setting?.percent != null ? String(setting.percent) : '');
  const [rows, setRows] = useState<Record<string, ModelRow>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [ladder, setLadder] = useState<{ tiers: FestivalOfferTier[]; live: boolean } | null>(null);

  // The product loads after first render; adopt its settings when they arrive.
  useEffect(() => {
    setSaved(setting ?? null);
    setMode(setting?.mode ?? 'auto');
    setPercentText(setting?.percent != null ? String(setting.percent) : '');
  }, [setting]);
  useEffect(() => {
    const entries = variantSettings ?? [];
    setSavedEntries(entries);
    const next: Record<string, ModelRow> = {};
    for (const e of entries) next[String(e.variantId)] = variantChoiceFromSetting(e);
    setRows(next);
  }, [variantSettings]);

  const hasModels = models.length > 0;

  // Tier ladder + switch state for the model preview column. A failed read only hides it.
  useEffect(() => {
    if (!hasModels || !canEdit) return undefined;
    let cancelled = false;
    apiClient.get<{ offer: { tiers: FestivalOfferTier[]; live: boolean } }>(API_ENDPOINTS.FESTIVAL_OFFER_ADMIN)
      .then((res) => { if (!cancelled && res?.offer?.tiers) setLadder({ tiers: res.offer.tiers, live: !!res.offer.live }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hasModels, canEdit]);

  const rowFor = (id: string): ModelRow => rows[id] ?? { mode: 'inherit', percentText: '' };
  const setRow = (id: string, patch: Partial<ModelRow>) => {
    setRows((r) => ({ ...r, [id]: { ...rowFor(id), ...patch } }));
    setMessage(null);
  };

  const percent = mode === 'custom' ? parseCustomPercent(percentText) : null;
  const percentInvalid = mode === 'custom' && percent === null;
  const badModels = models.filter((m) => rowFor(m._id).mode === 'custom' && parseCustomPercent(rowFor(m._id).percentText) === null);

  // What the admin is looking at right now (unsaved choices included), for the preview.
  const draftProductSetting: FestivalOfferSetting | null = mode === 'auto'
    ? null
    : mode === 'none' ? { mode: 'none' } : { mode: 'custom', percent: percent ?? -1 };
  const draft = {
    festivalOfferSetting: draftProductSetting,
    festivalOfferVariantSettings: models
      .map((m) => rowToEntry(m._id, rowFor(m._id)))
      .filter((e): e is FestivalVariantSetting => e !== null),
  };
  const preview = (m: FestivalPanelModel) => {
    if (!ladder || !(m.price > 0)) return null;
    const offer = applyFestivalOffer({ unitPrice: m.price, setting: resolveFestivalSetting(draft, m._id) }, ladder.tiers);
    return offer
      ? <><span className="font-semibold text-gray-900">{rupees(offer.finalPrice)}</span> <span className="text-green-700">({offer.percent}% off)</span></>
      : <span className="text-gray-700">{rupees(m.price)} <span className="text-gray-500">(normal price)</span></span>;
  };

  const modelLabel = (entry: FestivalVariantSetting | undefined) => {
    if (!entry) return `Same as product (${festivalSettingLabel(saved)})`;
    if (entry.mode === 'auto') return 'Automatic';
    return festivalSettingLabel(entry.mode === 'none' ? { mode: 'none' } : { mode: 'custom', percent: entry.percent });
  };

  if (!canEdit) {
    return (
      <section className="mt-6 rounded-lg border border-gray-200 p-4" aria-label="Diwali offer">
        <h3 className="font-semibold text-gray-900">Diwali offer</h3>
        <p className="mt-1 text-sm text-gray-600">
          {festivalSettingLabel(saved)}. Only an admin or the marketing team can change this.
        </p>
        {hasModels && (
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {models.map((m) => (
              <li key={m._id}>{m.label}: {modelLabel(savedEntries.find((e) => String(e.variantId) === m._id))}</li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const save = async () => {
    if (percentInvalid || badModels.length) {
      setMessage({
        ok: false,
        text: badModels.length ? `${badModels[0].label}: ${CUSTOM_PERCENT_ERROR}` : CUSTOM_PERCENT_ERROR,
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!hasModels && savedEntries.length === 0) {
        // No models: exactly the original single-product save.
        await saveFestivalOfferSetting([productId], mode, percent);
        const next: FestivalOfferSetting | null = mode === 'auto'
          ? null
          : mode === 'none' ? { mode: 'none' } : { mode: 'custom', percent: percent as number };
        setSaved(next);
        setMessage({ ok: true, text: `Saved: ${festivalSettingLabel(next)}` });
        return;
      }
      const res = await saveProductFestivalOffer(
        productId,
        mode,
        percent,
        models.map((m) => {
          const row = rowFor(m._id);
          return { variantId: m._id, mode: row.mode, percent: row.mode === 'custom' ? parseCustomPercent(row.percentText) : null };
        }),
      );
      setSaved(res.festivalOfferSetting ?? null);
      setSavedEntries(res.festivalOfferVariantSettings ?? []);
      const own = (res.festivalOfferVariantSettings ?? []).length;
      setMessage({
        ok: true,
        text: `Saved: ${festivalSettingLabel(res.festivalOfferSetting)}${hasModels ? ` · ${own} model${own === 1 ? '' : 's'} with their own offer` : ''}`,
      });
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
        {hasModels
          ? 'This choice applies to every model left at “Same as product”. You can change any model below. '
          : ''}
        Only takes effect while the Diwali discount is switched on. Saved separately from the product.
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

      {hasModels && (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-gray-900">Each model</h4>
          {ladder && !ladder.live && (
            <p className="mt-1 text-xs text-gray-600">
              The Diwali discount is switched off right now — “Customer pays” shows what they will pay once it is on.
            </p>
          )}
          <ul className="mt-2 min-w-0 divide-y divide-amber-100 rounded-lg border border-amber-100 bg-white">
            {models.map((m) => {
              const row = rowFor(m._id);
              const rowInvalid = row.mode === 'custom' && parseCustomPercent(row.percentText) === null;
              return (
                <li key={m._id} className="flex min-w-0 flex-col gap-2 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="min-w-0 sm:w-56">
                    <div className="truncate font-medium text-gray-900" title={m.label}>{m.label}</div>
                    <div className="text-gray-600">{m.price > 0 ? rupees(m.price) : '—'}</div>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <select
                      aria-label={`Diwali offer for ${m.label}`}
                      value={row.mode}
                      onChange={(e) => setRow(m._id, { mode: e.target.value as FestivalVariantMode })}
                      className="w-full min-w-0 max-w-full rounded border border-gray-300 bg-white px-2 py-2 sm:w-auto"
                    >
                      {MODEL_OPTIONS.map((o) => <option key={o.mode} value={o.mode}>{o.label}</option>)}
                    </select>
                    {row.mode === 'custom' && (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Custom percentage for ${m.label}`}
                          value={row.percentText}
                          onChange={(e) => setRow(m._id, { percentText: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                          aria-invalid={rowInvalid}
                          placeholder="1–30"
                          className={`w-16 rounded border px-2 py-2 ${rowInvalid ? 'border-red-400' : 'border-gray-300'}`}
                        />
                        <span className="text-gray-700">%</span>
                      </span>
                    )}
                  </div>
                  {ladder && (
                    <div className="sm:ml-auto sm:text-right">
                      <span className="text-gray-500">Customer pays </span>{preview(m)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {hasUnsavedModels && (
            <p className="mt-2 text-xs text-gray-600">
              New models appear here after you click Update to save the product. Until then they follow the product choice.
            </p>
          )}
        </div>
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
