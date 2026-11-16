/**
 * Shipping size class — Small / Medium / Large / XL — the coarse size every
 * product carries until (and alongside) a real packed measurement.
 *
 * Three inputs can decide a product's class, strongest first:
 *   1. an admin's (or the reviewed import's) explicit choice — `source: 'manual'`;
 *   2. the measured PACKED box (`shippingSize`);
 *   3. the product's size as LISTED ONLINE (`listedSize`, the bare product),
 *      grown by a packing allowance because the courier charges on the box.
 * 2 and 3 produce a suggestion (`source: 'auto'`) that is recomputed whenever a
 * size changes; a manual choice is never overwritten by a suggestion.
 *
 * Couriers bill the larger of dead weight and volumetric weight (L×B×H / 5000),
 * so the class is cut on that "chargeable" weight, not on kg alone — a light but
 * bulky roof box is a Large parcel.
 *
 * Pure: shared by the Product schema (enums), the admin write path, the bulk
 * setter and the import script. The admin editor mirrors these rules in
 * Front-end/web/src/lib/shippingClass.ts — keep the two in step.
 */

import { SHIPPING_SIZE_FIELDS } from './shippingSize.js';

export const SHIPPING_CLASSES = Object.freeze(['small', 'medium', 'large', 'xl']);
/** Classes that have a standard box. XL has none: it is freight, quoted after the order. */
export const BOXED_SHIPPING_CLASSES = Object.freeze(['small', 'medium', 'large']);
export const SHIPPING_CLASS_SOURCES = Object.freeze(['manual', 'auto']);

export const SHIPPING_CLASS_LABELS = Object.freeze({
  small: 'Small', medium: 'Medium', large: 'Large', xl: 'XL',
});

/** Upper bound (inclusive) of chargeable kg per class; anything above `large` is XL. */
export const SHIPPING_CLASS_MAX_KG = Object.freeze({ small: 2, medium: 10, large: 30 });

/** Volumetric divisor every Indian courier on Shiprocket uses (cm³ per kg). */
export const VOLUMETRIC_DIVISOR = 5000;

/** Packing allowance applied to an ONLINE (bare product) size to approximate its box. */
export const LISTED_BOX_MARGIN_CM = 5;
export const LISTED_BOX_WEIGHT_FACTOR = 1.1;

/** Starting standard boxes. Admin-editable afterwards (ShippingClassConfig). */
export const DEFAULT_CLASS_BOXES = Object.freeze({
  small:  Object.freeze({ weightKg: 1,  lengthCm: 30,  breadthCm: 20, heightCm: 15 }),
  medium: Object.freeze({ weightKg: 5,  lengthCm: 50,  breadthCm: 40, heightCm: 30 }),
  large:  Object.freeze({ weightKg: 20, lengthCm: 120, breadthCm: 60, heightCm: 40 }),
});

export const isShippingClass = (v) => SHIPPING_CLASSES.includes(v);

const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** True when all four numbers are present and positive. */
export function isCompleteSize(size) {
  return !!size && SHIPPING_SIZE_FIELDS.every((k) => isPositive(size[k]));
}

/** max(dead weight, volumetric weight), or null when the size is incomplete. */
export function chargeableWeightKg(size) {
  if (!isCompleteSize(size)) return null;
  const volumetric = (size.lengthCm * size.breadthCm * size.heightCm) / VOLUMETRIC_DIVISOR;
  return Math.max(size.weightKg, volumetric);
}

/** The bare product as listed online → the box it most likely ships in. */
export function boxFromListedSize(listed) {
  if (!isCompleteSize(listed)) return null;
  return {
    weightKg: listed.weightKg * LISTED_BOX_WEIGHT_FACTOR,
    lengthCm: listed.lengthCm + LISTED_BOX_MARGIN_CM,
    breadthCm: listed.breadthCm + LISTED_BOX_MARGIN_CM,
    heightCm: listed.heightCm + LISTED_BOX_MARGIN_CM,
  };
}

/** Chargeable kg → class. Boundaries are inclusive: exactly 2 kg is Small. */
export function classForChargeableKg(kg) {
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return null;
  if (kg <= SHIPPING_CLASS_MAX_KG.small) return 'small';
  if (kg <= SHIPPING_CLASS_MAX_KG.medium) return 'medium';
  if (kg <= SHIPPING_CLASS_MAX_KG.large) return 'large';
  return 'xl';
}

/**
 * The class the sizes point to, or null when neither size is complete.
 * A measured packed box beats the online size: it is the real parcel.
 */
export function suggestShippingClass({ shippingSize, listedSize } = {}) {
  const packed = chargeableWeightKg(shippingSize);
  if (packed != null) return classForChargeableKg(packed);
  const fromListed = chargeableWeightKg(boxFromListedSize(listedSize));
  return fromListed != null ? classForChargeableKg(fromListed) : null;
}

/**
 * Parse what a client sent for the class.
 *   undefined          → not sent (leave it)
 *   '' / null / 'auto' → "Automatic": follow the sizes
 *   a class name       → that class, chosen by a person (case-insensitive)
 * Anything else throws a TypeError the caller turns into a 400.
 */
export function parseShippingClassInput(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return 'auto';
  if (typeof raw !== 'string') throw new TypeError('invalid shipping class');
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'auto') return 'auto';
  if (isShippingClass(v)) return v;
  throw new TypeError('invalid shipping class');
}

/**
 * What to store for `shippingClass` + `shippingClassSource` after a write.
 *
 * @param {object}  args
 * @param {string|undefined} args.requested  output of parseShippingClassInput
 * @param {{ shippingClass?, shippingClassSource? }|null} args.current  stored values (null on create)
 * @param {{ shippingSize?, listedSize? }} args.sizes  the sizes AFTER this write
 * @returns {{ shippingClass, shippingClassSource }}
 */
export function resolveShippingClass({ requested, current, sizes }) {
  if (requested && requested !== 'auto') {
    return { shippingClass: requested, shippingClassSource: 'manual' };
  }
  // Not sent, and a person chose the current class: keep their choice.
  if (requested === undefined && current?.shippingClassSource === 'manual') {
    return { shippingClass: current.shippingClass ?? null, shippingClassSource: 'manual' };
  }
  const suggested = suggestShippingClass(sizes);
  return { shippingClass: suggested, shippingClassSource: suggested ? 'auto' : null };
}

/** A box for every boxed class, each with four positive numbers. */
export function isValidClassBoxes(boxes) {
  return !!boxes && BOXED_SHIPPING_CLASSES.every((c) => isCompleteSize(boxes[c]));
}
