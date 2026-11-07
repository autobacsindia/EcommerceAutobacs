/**
 * A product's packed parcel size (what the courier charges on) — editor helpers.
 * Limits mirror Back-end/server/utils/shippingSize.js; the server is the final check.
 */

export type ShippingSizeKey = 'weightKg' | 'lengthCm' | 'breadthCm' | 'heightCm';

/** What the editor holds: raw input text, '' = not measured yet. */
export type ShippingSizeForm = Record<ShippingSizeKey, string>;

/** What the API stores: a number, or null when not measured. */
export type ShippingSize = Partial<Record<ShippingSizeKey, number | null>>;

export const SHIPPING_SIZE_KEYS: readonly ShippingSizeKey[] = ['weightKg', 'lengthCm', 'breadthCm', 'heightCm'];

export const SHIPPING_SIZE_LIMITS: Record<ShippingSizeKey, { min: number; max: number }> = {
  weightKg: { min: 0.01, max: 500 },
  lengthCm: { min: 0.5, max: 400 },
  breadthCm: { min: 0.5, max: 400 },
  heightCm: { min: 0.5, max: 400 },
};

export const SHIPPING_SIZE_LABELS: Record<ShippingSizeKey, string> = {
  weightKg: 'Weight (kg)',
  lengthCm: 'Length (cm)',
  breadthCm: 'Width (cm)',
  heightCm: 'Height (cm)',
};

export const EMPTY_SHIPPING_SIZE: ShippingSizeForm = { weightKg: '', lengthCm: '', breadthCm: '', heightCm: '' };

/** Stored size → editor text. */
export function shippingSizeToForm(size: ShippingSize | null | undefined): ShippingSizeForm {
  const out = { ...EMPTY_SHIPPING_SIZE };
  for (const k of SHIPPING_SIZE_KEYS) {
    const v = size?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
}

/** Plain-English problem with one field, or null when it is fine (blank is fine). */
export function shippingSizeError(key: ShippingSizeKey, raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return 'Numbers only';
  const { min, max } = SHIPPING_SIZE_LIMITS[key];
  const unit = key === 'weightKg' ? 'kg' : 'cm';
  if (n < min) return `At least ${min} ${unit}`;
  if (n > max) return `At most ${max} ${unit}${key === 'weightKg' ? ' — typed grams by mistake?' : ''}`;
  return null;
}

/** First problem across all fields, for blocking Save. */
export function firstShippingSizeError(form: ShippingSizeForm): string | null {
  for (const k of SHIPPING_SIZE_KEYS) {
    const e = shippingSizeError(k, form[k]);
    if (e) return `${SHIPPING_SIZE_LABELS[k]}: ${e}`;
  }
  return null;
}

/** Editor text → API payload (blank → null, so clearing a field really clears it). */
export function shippingSizeToPayload(form: ShippingSizeForm): Record<ShippingSizeKey, number | null> {
  const out = {} as Record<ShippingSizeKey, number | null>;
  for (const k of SHIPPING_SIZE_KEYS) {
    const text = form[k].trim();
    out[k] = text === '' ? null : Number(text);
  }
  return out;
}

/** Courier's chargeable weight: max(dead weight, L×B×H / 5000). null until all four are filled. */
export function chargeableWeightKg(form: ShippingSizeForm): number | null {
  const p = shippingSizeToPayload(form);
  if (SHIPPING_SIZE_KEYS.some((k) => p[k] == null || !Number.isFinite(p[k] as number) || (p[k] as number) <= 0)) return null;
  const volumetric = ((p.lengthCm as number) * (p.breadthCm as number) * (p.heightCm as number)) / 5000;
  return Math.round(Math.max(p.weightKg as number, volumetric) * 100) / 100;
}
