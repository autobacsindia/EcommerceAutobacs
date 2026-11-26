/**
 * Delivery window rule ("Nothing Extra", 2026-11-23): general 7–10 days, heavy
 * (Large/XL box) 10–15. Never a faster window than the box allows.
 */
import { deliveryWindowFor, sizeClassForTiming, DELIVERY_WINDOWS } from '../utils/deliveryWindow.js';

const GENERAL = { minDays: 7, maxDays: 10, heavy: false };
const HEAVY = { minDays: 10, maxDays: 15, heavy: true };

describe('deliveryWindowFor', () => {
  it('no size, no class, no category → the general window (fallback)', () => {
    expect(sizeClassForTiming({})).toBeNull();
    expect(deliveryWindowFor({})).toEqual(GENERAL);
    expect(deliveryWindowFor(null)).toEqual(GENERAL);
  });

  it.each([['small', GENERAL], ['medium', GENERAL], ['large', HEAVY], ['xl', HEAVY]])(
    'stored class %s', (cls, want) => expect(deliveryWindowFor({ shippingClass: cls })).toEqual(want),
  );

  it('category guess is used only when nothing better exists', () => {
    expect(deliveryWindowFor({ categoryClass: 'xl' })).toEqual(HEAVY);
    expect(deliveryWindowFor({ shippingClass: 'small', categoryClass: 'xl' })).toEqual(GENERAL);
  });

  it('a measured box beats the stored class (heavy by volumetric weight)', () => {
    // 100×60×50 / 5000 = 60 kg chargeable → XL, even though the box weighs 8 kg
    const shippingSize = { weightKg: 8, lengthCm: 100, breadthCm: 60, heightCm: 50 };
    expect(deliveryWindowFor({ shippingSize, shippingClass: 'small' })).toEqual(HEAVY);
    expect(deliveryWindowFor({ shippingSize: { weightKg: 1, lengthCm: 20, breadthCm: 10, heightCm: 10 }, shippingClass: 'xl' })).toEqual(GENERAL);
  });

  it('an incomplete measured size is ignored, falling through to the class', () => {
    expect(deliveryWindowFor({ shippingSize: { weightKg: 50 }, shippingClass: 'medium' })).toEqual(GENERAL);
  });

  it('online listed size (plus packing margin) decides when no measured box', () => {
    const listedSize = { weightKg: 25, lengthCm: 80, breadthCm: 40, heightCm: 30 };
    expect(deliveryWindowFor({ listedSize })).toEqual(HEAVY);
  });

  it('the heavy window is never faster than the general one', () => {
    expect(DELIVERY_WINDOWS.heavy.minDays).toBeGreaterThanOrEqual(DELIVERY_WINDOWS.general.minDays);
    expect(DELIVERY_WINDOWS.heavy.maxDays).toBeGreaterThanOrEqual(DELIVERY_WINDOWS.general.maxDays);
    expect(Object.isFrozen(DELIVERY_WINDOWS.general)).toBe(true);
  });
});
