/**
 * The Hilux owners' card coupon (scripts/create-hilux-owner-coupon.js). The rule
 * document is checked against the owner's brief, and then saved through the real
 * Coupon model so a schema change that would silently drop `appliesTo.vehicles`
 * (and turn the coupon into ₹5,000 off ANY ₹25,000 cart) fails here.
 */
import mongoose from 'mongoose';
import Coupon from '../models/Coupon.js';
import { buildHiluxCoupon, HILUX_COUPON_CODE, HILUX_VEHICLE_SLUGS } from '../scripts/create-hilux-owner-coupon.js';

describe('Hilux owners card coupon', () => {
  const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];

  test('matches the agreed rules', () => {
    const doc = buildHiluxCoupon(ids);
    expect(doc).toMatchObject({
      code: 'HILUX5000', type: 'fixed', value: 5000, minCartValue: 25000,
      usageLimitPerUser: 1, usageLimit: null, expiresAt: null, visibility: 'hidden', isActive: true,
    });
    expect(doc.appliesTo.vehicles).toEqual(ids);
    expect(HILUX_VEHICLE_SLUGS).toEqual(['toyota-hilux-revo', 'toyota-hilux-travo']);
  });

  test('the vehicle scope survives the Coupon schema', () => {
    const coupon = new Coupon(buildHiluxCoupon(ids));
    expect(coupon.validateSync()).toBeUndefined();
    expect(coupon.code).toBe(HILUX_COUPON_CODE);
    expect(coupon.appliesTo.vehicles.map(String)).toEqual(ids.map(String));
  });
});
