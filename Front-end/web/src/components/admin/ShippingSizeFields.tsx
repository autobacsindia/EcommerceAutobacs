'use client';

import type { ReactNode } from 'react';
import {
  SHIPPING_SIZE_KEYS,
  SHIPPING_SIZE_LABELS,
  chargeableWeightKg,
  shippingSizeError,
  type ShippingSizeForm,
  type ShippingSizeKey,
} from '@/lib/shippingSize';
import {
  SHIPPING_CLASSES,
  SHIPPING_CLASS_HINTS,
  SHIPPING_CLASS_LABELS,
  sourceUrlError,
  suggestShippingClass,
  type ListedSizeForm,
  type ShippingClassChoice,
} from '@/lib/shippingClass';

function SizeGrid<T extends ShippingSizeForm>({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {SHIPPING_SIZE_KEYS.map((key: ShippingSizeKey) => {
        const error = shippingSizeError(key, value[key]);
        const id = `${idPrefix}-${key}`;
        return (
          <div key={key}>
            <label htmlFor={id} className="block text-xs text-gray-600 mb-1">{SHIPPING_SIZE_LABELS[key]}</label>
            <input
              id={id}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className={`w-full border rounded px-3 py-2 text-sm ${error ? 'border-red-500' : 'border-gray-300'}`}
            />
            {error && <p id={`${id}-error`} className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}

const Group = ({ title, hint, children }: { title: string; hint: string; children: ReactNode }) => (
  <div className="mt-4">
    <p className="text-sm font-medium text-gray-700">{title}</p>
    <p className="text-xs text-gray-500 mb-2">{hint}</p>
    {children}
  </div>
);

/**
 * "Parcel size (for the courier)" box on the product editor:
 *   1. Size class — Automatic (follows the sizes) or a fixed choice;
 *   2. the product's size as listed online (bare product) + where it was found;
 *   3. the measured packed box, which beats both once someone measures it.
 * Everything optional — blank means not known yet.
 */
export default function ShippingSizeFields({
  value,
  onChange,
  listed,
  onListedChange,
  shippingClass,
  onShippingClassChange,
}: {
  value: ShippingSizeForm;
  onChange: (next: ShippingSizeForm) => void;
  listed: ListedSizeForm;
  onListedChange: (next: ListedSizeForm) => void;
  shippingClass: ShippingClassChoice;
  onShippingClassChange: (next: ShippingClassChoice) => void;
}) {
  const chargeable = chargeableWeightKg(value);
  const weight = Number(value.weightKg);
  const suggested = suggestShippingClass(value, listed);
  const urlError = sourceUrlError(listed.sourceUrl);
  const overridden = shippingClass !== '' && suggested && suggested !== shippingClass;

  return (
    <fieldset className="mb-4 border-t border-gray-200 pt-4">
      <legend className="block text-sm font-medium text-gray-700 mb-1">Parcel size (for the courier)</legend>

      <label htmlFor="shippingClass" className="block text-xs text-gray-600 mb-1">Size class</label>
      <select
        id="shippingClass"
        value={shippingClass}
        onChange={(e) => onShippingClassChange(e.target.value as ShippingClassChoice)}
        className="w-full sm:w-80 border border-gray-300 rounded px-3 py-2 text-sm bg-white"
      >
        <option value="">
          {suggested ? `Automatic — ${SHIPPING_CLASS_LABELS[suggested]} (from the size)` : 'Automatic — not set until a size is entered'}
        </option>
        {SHIPPING_CLASSES.map((c) => (
          <option key={c} value={c}>{SHIPPING_CLASS_LABELS[c]} ({SHIPPING_CLASS_HINTS[c]})</option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">
        Classes go by what the courier charges: the heavier of the weight and the box size.
      </p>
      {overridden && (
        <p className="mt-1 text-xs text-amber-700">
          The size says {SHIPPING_CLASS_LABELS[suggested]}. Your choice of {SHIPPING_CLASS_LABELS[shippingClass]} is kept.
        </p>
      )}

      <Group title="Product size online" hint="The bare product as the brand or a shop lists it — not the box. We add a little for packing.">
        <SizeGrid idPrefix="listedSize" value={listed} onChange={onListedChange} />
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label htmlFor="listedSize-sourceUrl" className="block text-xs text-gray-600 mb-1">Where you found it (link)</label>
            <input
              id="listedSize-sourceUrl"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={listed.sourceUrl}
              onChange={(e) => onListedChange({ ...listed, sourceUrl: e.target.value })}
              aria-invalid={urlError ? true : undefined}
              aria-describedby={urlError ? 'listedSize-sourceUrl-error' : undefined}
              className={`w-full border rounded px-3 py-2 text-sm ${urlError ? 'border-red-500' : 'border-gray-300'}`}
            />
            {urlError && <p id="listedSize-sourceUrl-error" className="mt-1 text-xs text-red-600">{urlError}</p>}
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 pb-2">
            <input
              type="checkbox"
              checked={listed.estimated}
              onChange={(e) => onListedChange({ ...listed, estimated: e.target.checked })}
            />
            Estimated from a similar product
          </label>
        </div>
      </Group>

      <Group title="Packed box (measured)" hint="Measure it packed, in its box. Leave blank if not measured yet. This beats the online size.">
        <SizeGrid idPrefix="shippingSize" value={value} onChange={onChange} />
        {chargeable != null && chargeable > weight && (
          <p className="mt-2 text-xs text-amber-700">
            The box is big for its weight: couriers will charge it as {chargeable} kg.
          </p>
        )}
      </Group>
    </fieldset>
  );
}
