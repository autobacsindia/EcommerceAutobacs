/**
 * Size class (Small / Medium / Large / XL) + the product's size as listed online —
 * editor and list helpers. Rules mirror Back-end/server/utils/shippingClass.js;
 * the server decides what is stored, this only previews its suggestion.
 */

import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import {
  EMPTY_SHIPPING_SIZE,
  SHIPPING_SIZE_KEYS,
  chargeableWeightKg,
  firstShippingSizeError,
  shippingSizeToForm,
  shippingSizeToPayload,
  type ShippingSize,
  type ShippingSizeForm,
} from '@/lib/shippingSize';

export type ShippingClass = 'small' | 'medium' | 'large' | 'xl';
export type ShippingClassSource = 'manual' | 'auto';
/** The editor's dropdown: '' = Automatic (follow the sizes). */
export type ShippingClassChoice = '' | ShippingClass;

export const SHIPPING_CLASSES: readonly ShippingClass[] = ['small', 'medium', 'large', 'xl'];
export const BOXED_SHIPPING_CLASSES = ['small', 'medium', 'large'] as const;
export type BoxedShippingClass = (typeof BOXED_SHIPPING_CLASSES)[number];

export const SHIPPING_CLASS_LABELS: Record<ShippingClass, string> = {
  small: 'Small', medium: 'Medium', large: 'Large', xl: 'XL',
};
export const SHIPPING_CLASS_HINTS: Record<ShippingClass, string> = {
  small: 'up to 2 kg',
  medium: 'up to 10 kg',
  large: 'up to 30 kg',
  xl: 'over 30 kg — quote after the order',
};

/** Inclusive upper bound of chargeable kg per class; above `large` is XL. */
export const SHIPPING_CLASS_MAX_KG = { small: 2, medium: 10, large: 30 } as const;
export const LISTED_BOX_MARGIN_CM = 5;
export const LISTED_BOX_WEIGHT_FACTOR = 1.1;
export const LISTED_SIZE_SOURCE_MAX = 500;

export function classForChargeableKg(kg: number | null): ShippingClass | null {
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return null;
  if (kg <= SHIPPING_CLASS_MAX_KG.small) return 'small';
  if (kg <= SHIPPING_CLASS_MAX_KG.medium) return 'medium';
  if (kg <= SHIPPING_CLASS_MAX_KG.large) return 'large';
  return 'xl';
}

/** Online (bare product) size as the editor holds it. */
export interface ListedSizeForm extends ShippingSizeForm {
  sourceUrl: string;
  estimated: boolean;
}
export interface ListedSize extends ShippingSize {
  sourceUrl?: string | null;
  estimated?: boolean;
}

export const EMPTY_LISTED_SIZE: ListedSizeForm = { ...EMPTY_SHIPPING_SIZE, sourceUrl: '', estimated: false };

export function listedSizeToForm(size: ListedSize | null | undefined): ListedSizeForm {
  return {
    ...shippingSizeToForm(size),
    sourceUrl: typeof size?.sourceUrl === 'string' ? size.sourceUrl : '',
    estimated: size?.estimated === true,
  };
}

export function listedSizeToPayload(form: ListedSizeForm) {
  const url = form.sourceUrl.trim();
  return { ...shippingSizeToPayload(form), sourceUrl: url === '' ? null : url, estimated: form.estimated };
}

export function sourceUrlError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length > LISTED_SIZE_SOURCE_MAX) return `At most ${LISTED_SIZE_SOURCE_MAX} characters`;
  if (!/^https?:\/\/\S+$/i.test(v)) return 'Paste the full link, starting with https://';
  return null;
}

/** First problem in the online-size box, for blocking Save. */
export function firstListedSizeError(form: ListedSizeForm): string | null {
  const size = firstShippingSizeError(form);
  if (size) return `Online size — ${size}`;
  const url = sourceUrlError(form.sourceUrl);
  return url ? `Online size — Source link: ${url}` : null;
}

const listedToBox = (form: ShippingSizeForm): ShippingSizeForm | null => {
  if (chargeableWeightKg(form) == null) return null; // incomplete or invalid
  const p = shippingSizeToPayload(form);
  return {
    weightKg: String((p.weightKg as number) * LISTED_BOX_WEIGHT_FACTOR),
    lengthCm: String((p.lengthCm as number) + LISTED_BOX_MARGIN_CM),
    breadthCm: String((p.breadthCm as number) + LISTED_BOX_MARGIN_CM),
    heightCm: String((p.heightCm as number) + LISTED_BOX_MARGIN_CM),
  };
};

/** What "Automatic" would pick: the packed box first, else the online size plus packing. */
export function suggestShippingClass(packed: ShippingSizeForm, listed: ShippingSizeForm): ShippingClass | null {
  const fromPacked = chargeableWeightKg(packed);
  if (fromPacked != null) return classForChargeableKg(fromPacked);
  const box = listedToBox(listed);
  return box ? classForChargeableKg(chargeableWeightKg(box)) : null;
}

/** Stored class → dropdown value (only a person's choice is shown as fixed). */
export function shippingClassToChoice(cls: ShippingClass | null | undefined, source: ShippingClassSource | null | undefined): ShippingClassChoice {
  return source === 'manual' && cls && SHIPPING_CLASSES.includes(cls) ? cls : '';
}

export function shippingClassLabel(cls: ShippingClass | null | undefined): string {
  return cls ? SHIPPING_CLASS_LABELS[cls] : 'Not set';
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface ShippingClassBulkResult { requested: number; updated: number; unchanged: number; notFound: string[] }

export async function saveShippingClass(productIds: string[], shippingClass: ShippingClass | 'auto'): Promise<ShippingClassBulkResult> {
  return apiClient.patch<ShippingClassBulkResult>(API_ENDPOINTS.PRODUCT_SHIPPING_CLASS, { productIds, shippingClass });
}

export type ClassBoxes = Record<BoxedShippingClass, Record<(typeof SHIPPING_SIZE_KEYS)[number], number>>;
export interface ClassBoxesResponse { boxes: ClassBoxes; updatedAt: string | null }

export async function fetchClassBoxes(): Promise<ClassBoxesResponse> {
  return apiClient.get<ClassBoxesResponse>(API_ENDPOINTS.PRODUCT_SHIPPING_CLASS_BOXES);
}

export async function saveClassBoxes(boxes: Record<BoxedShippingClass, ShippingSizeForm>): Promise<ClassBoxesResponse> {
  const payload = Object.fromEntries(BOXED_SHIPPING_CLASSES.map((c) => [c, shippingSizeToPayload(boxes[c])]));
  return apiClient.put<ClassBoxesResponse>(API_ENDPOINTS.PRODUCT_SHIPPING_CLASS_BOXES, { boxes: payload });
}

/** Admin or marketing team — the same people who edit products. The server enforces it. */
export function canChangeShippingClass(
  user: { role?: string; staff?: { team?: string } | null } | null | undefined,
): boolean {
  return user?.role === 'admin' || user?.staff?.team === 'marketing';
}
