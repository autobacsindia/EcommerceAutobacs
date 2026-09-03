/**
 * setBusinessProfile — the conditional write.
 *
 * This is an OPTIMIZATION over a previously-unconditional update, so the tests
 * that matter are the ones proving behaviour was preserved: a new profile is
 * still saved, a CHANGED profile is still saved, and only a genuinely unchanged
 * one is skipped. An over-eager skip would silently stop a corrected GSTIN from
 * ever reaching the saved profile — and that profile prefills the next order, so
 * the stale value would be re-submitted on every subsequent purchase.
 */

import mongoose from 'mongoose';
import { useTransactionalDb } from '../../helpers/replicaSet.js';
import User from '../../../models/User.js';
import userRepository from '../../../repositories/userRepository.js';

const PROFILE = {
  legalName: 'Roavion Motors Private Limited',
  gstin: '27AAPFU0939F1ZV',
  stateCode: '27',
  billingAddress: {
    addressLine1: '12 Marine Drive', addressLine2: 'Second floor', city: 'Kochi',
    state: 'Maharashtra', stateCode: '27', postalCode: '682011', country: 'India',
    phone: '9999999999',
  },
};

const seedUser = () => User.create({
  name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x',
});

beforeAll(async () => { await useTransactionalDb(); });

describe('setBusinessProfile', () => {
  it('writes a profile onto a user who has none', async () => {
    const user = await seedUser();
    const result = await userRepository.setBusinessProfile(user._id, PROFILE);

    expect(result).not.toBeNull();
    const stored = await User.findById(user._id).lean();
    expect(stored.businessProfile).toMatchObject({
      legalName: PROFILE.legalName, gstin: PROFILE.gstin, stateCode: '27',
    });
    expect(stored.businessProfile.updatedAt).toBeInstanceOf(Date);
  });

  it('skips the write when nothing changed', async () => {
    const user = await seedUser();
    await userRepository.setBusinessProfile(user._id, PROFILE);
    const first = await User.findById(user._id).lean();

    const second = await userRepository.setBusinessProfile(user._id, PROFILE);

    // null signals "matched nothing to update" — not a failure.
    expect(second).toBeNull();
    const after = await User.findById(user._id).lean();
    // updatedAt untouched proves no write actually happened.
    expect(after.businessProfile.updatedAt).toEqual(first.businessProfile.updatedAt);
  });

  it.each([
    ['a corrected GSTIN',       { gstin: '29AAGCB7383J1Z4' }],
    ['a renamed entity',        { legalName: 'Roavion Motors LLP' }],
    ['a corrected state code',  { stateCode: '29' }],
  ])('still writes when the profile changes: %s', async (_label, change) => {
    const user = await seedUser();
    await userRepository.setBusinessProfile(user._id, PROFILE);

    const result = await userRepository.setBusinessProfile(user._id, { ...PROFILE, ...change });

    expect(result).not.toBeNull();
    const stored = await User.findById(user._id).lean();
    expect(stored.businessProfile).toMatchObject(change);
  });

  // EVERY stored billing field, not a hand-picked few: the first version of the
  // no-op filter compared only addressLine1/city/postalCode, so correcting just a
  // phone number or an addressLine2 was silently discarded — and this profile
  // prefills the next checkout, so the stale value came back every order.
  it.each([
    ['addressLine1'], ['addressLine2'], ['city'], ['state'],
    ['stateCode'], ['postalCode'], ['country'], ['phone'],
  ])(
    'still writes when billing %s changes',
    async (field) => {
      const user = await seedUser();
      await userRepository.setBusinessProfile(user._id, PROFILE);

      const changed = {
        ...PROFILE,
        billingAddress: { ...PROFILE.billingAddress, [field]: 'CHANGED-VALUE' },
      };
      const result = await userRepository.setBusinessProfile(user._id, changed);

      expect(result).not.toBeNull();
      const stored = await User.findById(user._id).lean();
      expect(stored.businessProfile.billingAddress[field]).toBe('CHANGED-VALUE');
    },
  );

  it('does not touch a different user', async () => {
    // The `_id` clause has to survive alongside the `$or`; without it the filter
    // would match the first user in the collection whose profile differs.
    const [a, b] = [await seedUser(), await seedUser()];
    await userRepository.setBusinessProfile(a._id, PROFILE);

    const storedB = await User.findById(b._id).lean();
    expect(storedB.businessProfile).toBeUndefined();
  });
});
