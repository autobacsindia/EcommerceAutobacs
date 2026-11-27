import { beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

/**
 * Minimum margin (2026-11-26) blocks a supplier payment for an order that leaves us
 * under 30% unless procurement gives a reason. Suites written before that rule raise
 * supplier payments at whatever amount suits what they test (bills, deals, credit…),
 * so they turn the check off here — some even buy above the sale price, which no 0%
 * minimum would let through. The floor is written to the collection directly (the
 * admin screen only takes 0–90%). The rule itself is covered by
 * tests/supplierMargin.test.js — never call this there.
 *
 * Re-applied before every test because the suites clear the database after each one.
 * Direct collection access also means importing this never loads a model ahead of a
 * suite's jest.unstable_mockModule calls.
 */
export const withoutMinimumMargin = () => {
  beforeEach(async () => {
    await mongoose.connection.collection('marginconfig')
      .updateOne({ key: 'default' }, { $set: { minBp: Number.MIN_SAFE_INTEGER } }, { upsert: true });
  });
};
