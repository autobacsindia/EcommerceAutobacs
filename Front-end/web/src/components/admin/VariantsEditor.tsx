'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { StockStatus } from '@/lib/stock';

/**
 * Admin editor for a variable product's models (variants). Single-attribute
 * (e.g. "models") — the shape this catalogue uses. Each row is one selectable
 * model with its own price, optional "was" price, stock status and optional SKU.
 *
 * Controlled: the parent owns `attributeName` + `variants` and serializes them
 * into the product payload (attributes = [{ name: attributeName, option: label }]).
 * Existing rows keep their `_id` so cart/order references survive an edit.
 */
export interface EditorVariant {
  _id?: string;
  label: string;
  price: string;
  originalPrice?: string;
  stock: StockStatus;
  sku?: string;
}

const STOCK_OPTIONS: { value: StockStatus; label: string }[] = [
  { value: 'in', label: 'In stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
  { value: 'backorder', label: 'Backorder' },
];

export const emptyVariant = (): EditorVariant => ({ label: '', price: '', originalPrice: '', stock: 'in', sku: '' });

export default function VariantsEditor({
  attributeName,
  onAttributeNameChange,
  variants,
  onChange,
}: {
  attributeName: string;
  onAttributeNameChange: (name: string) => void;
  variants: EditorVariant[];
  onChange: (variants: EditorVariant[]) => void;
}) {
  const update = (i: number, patch: Partial<EditorVariant>) =>
    onChange(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const remove = (i: number) => onChange(variants.filter((_, idx) => idx !== i));
  const add = () => onChange([...variants, emptyVariant()]);

  return (
    <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/40">
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Option name</label>
        <input
          type="text"
          value={attributeName}
          onChange={(e) => onAttributeNameChange(e.target.value)}
          placeholder="e.g. models"
          className="w-full sm:w-64 border rounded-lg px-3 py-2 text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">The dropdown label shoppers see (e.g. “Select model”).</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-2 pr-3 font-medium">Model / option</th>
              <th className="py-2 pr-3 font-medium">Price (₹)</th>
              <th className="py-2 pr-3 font-medium">Was (₹)</th>
              <th className="py-2 pr-3 font-medium">Stock</th>
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={v._id ?? i} className="border-t border-indigo-100">
                <td className="py-2 pr-3">
                  <input
                    type="text"
                    value={v.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    placeholder="COROLLA ALTIS 1.8 P"
                    className="w-full min-w-48 border rounded px-2 py-1.5"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number" min="0" step="0.01"
                    value={v.price}
                    onChange={(e) => update(i, { price: e.target.value })}
                    className="w-28 border rounded px-2 py-1.5"
                  />
                </td>
                <td className="py-2 pr-3 align-top">
                  <input
                    type="number" min="0" step="0.01"
                    value={v.originalPrice ?? ''}
                    onChange={(e) => update(i, { originalPrice: e.target.value })}
                    placeholder="—"
                    className={`w-24 border rounded px-2 py-1.5 ${isWasPriceInvalid(v) ? 'border-red-400 bg-red-50' : ''}`}
                    aria-invalid={isWasPriceInvalid(v)}
                  />
                  {isWasPriceInvalid(v) && (
                    <p className="text-[11px] text-red-500 mt-1 max-w-24">Must exceed price, or it won’t show a discount.</p>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={v.stock}
                    onChange={(e) => update(i, { stock: e.target.value as StockStatus })}
                    className="border rounded px-2 py-1.5 bg-white"
                  >
                    {STOCK_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="text"
                    value={v.sku ?? ''}
                    onChange={(e) => update(i, { sku: e.target.value })}
                    placeholder="—"
                    className="w-28 border rounded px-2 py-1.5"
                  />
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-gray-400 hover:text-red-500"
                    aria-label="Remove model"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {variants.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">No models yet — add one below.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-3 inline-flex items-center gap-2 text-sm text-indigo-700 hover:text-indigo-900"
      >
        <Plus className="h-4 w-4" /> Add model
      </button>

      <p className="text-xs text-gray-500 mt-3">
        Price shows as a range until a shopper picks a model. Set “Was (₹)” only for a genuine discount. A model marked
        Out of stock can’t be added to cart.
      </p>
    </div>
  );
}

// Serialize editor rows → the API `variants` payload (attributes derived from the
// single option name). Drops blank rows. Keeps `_id` so references survive edits.
export function serializeVariants(attributeName: string, variants: EditorVariant[]) {
  return variants
    .map((v) => {
      const price = Number(v.price) || 0;
      const was = v.originalPrice != null && v.originalPrice !== '' ? Number(v.originalPrice) : null;
      return {
        ...(v._id && { _id: v._id }),
        label: v.label.trim(),
        attributes: [{ name: (attributeName || 'option').trim(), option: v.label.trim() }],
        price,
        // Keep "Was (₹)" only when it's a genuine discount (> price); otherwise it
        // would render no badge and just be misleading stored data.
        originalPrice: was != null && was > price ? was : null,
        stock: v.stock,
        ...(v.sku && v.sku.trim() && { sku: v.sku.trim() }),
      };
    })
    .filter((v) => v.label && v.price >= 0);
}

/** True when a row has a "Was (₹)" that isn't a genuine discount (≤ price). */
export const isWasPriceInvalid = (v: EditorVariant) =>
  v.originalPrice != null && v.originalPrice !== '' && Number(v.originalPrice) <= Number(v.price);
