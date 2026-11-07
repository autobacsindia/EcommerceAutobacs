'use client';

import {
  SHIPPING_SIZE_KEYS,
  SHIPPING_SIZE_LABELS,
  chargeableWeightKg,
  shippingSizeError,
  type ShippingSizeForm,
  type ShippingSizeKey,
} from '@/lib/shippingSize';

/**
 * "Parcel size" box on the product editor: the boxed weight and size the courier
 * charges on. All optional — blank means not measured yet.
 */
export default function ShippingSizeFields({
  value,
  onChange,
}: {
  value: ShippingSizeForm;
  onChange: (next: ShippingSizeForm) => void;
}) {
  const set = (key: ShippingSizeKey, text: string) => onChange({ ...value, [key]: text });
  const chargeable = chargeableWeightKg(value);
  const weight = Number(value.weightKg);

  return (
    <fieldset className="mb-4 border-t border-gray-200 pt-4">
      <legend className="block text-sm font-medium text-gray-700 mb-1">Parcel size (for the courier)</legend>
      <p className="text-xs text-gray-500 mb-2">Measure it packed, in its box. Leave blank if not measured yet.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SHIPPING_SIZE_KEYS.map((key) => {
          const error = shippingSizeError(key, value[key]);
          const id = `shippingSize-${key}`;
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
                onChange={(e) => set(key, e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                className={`w-full border rounded px-3 py-2 text-sm ${error ? 'border-red-500' : 'border-gray-300'}`}
              />
              {error && <p id={`${id}-error`} className="mt-1 text-xs text-red-600">{error}</p>}
            </div>
          );
        })}
      </div>
      {chargeable != null && chargeable > weight && (
        <p className="mt-2 text-xs text-amber-700">
          The box is big for its weight: couriers will charge it as {chargeable} kg.
        </p>
      )}
    </fieldset>
  );
}
