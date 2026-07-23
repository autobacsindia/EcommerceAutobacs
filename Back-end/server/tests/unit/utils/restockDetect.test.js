/**
 * Pure transition-detection for the back-in-stock feature. No DB — just the
 * out → in/low edge logic that decides who gets emailed. This is the core the
 * whole feature hangs on, so the matrix is exhaustive.
 */

import { snapshotStock, diffRecoveredTargets } from '../../../utils/restockDetect.js';

const oid = (n) => ({ toString: () => `v${n}` }); // stand-in for a variant _id

describe('snapshotStock', () => {
  test('returns null for a missing doc (a create — nothing to recover from)', () => {
    expect(snapshotStock(null)).toBeNull();
  });

  test('captures parent status and an empty variant map for a simple product', () => {
    expect(snapshotStock({ stock: 'out', variants: [] })).toEqual({ parent: 'out', variants: {} });
  });

  test('maps each variant status by _id for a variable product', () => {
    const snap = snapshotStock({
      stock: 'out',
      variants: [{ _id: oid(1), stock: 'out' }, { _id: oid(2), stock: 'in' }],
    });
    expect(snap).toEqual({ parent: 'out', variants: { v1: 'out', v2: 'in' } });
  });
});

describe('diffRecoveredTargets', () => {
  const snap = (parent, variants = {}) => ({ parent, variants });

  test('no fire when either snapshot is missing', () => {
    expect(diffRecoveredTargets(null, snap('in'))).toEqual([]);
    expect(diffRecoveredTargets(snap('out'), null)).toEqual([]);
  });

  test.each([
    ['out', 'in', [null]],
    ['out', 'low', [null]],
  ])('simple product %s → %s fires whole-item', (before, after, expected) => {
    expect(diffRecoveredTargets(snap(before), snap(after))).toEqual(expected);
  });

  test.each([
    ['in', 'out'],
    ['low', 'out'],
    ['in', 'low'],
    ['out', 'backorder'], // backorder is not purchasable — enquiry-only, not a restock
    ['out', 'out'],
  ])('simple product %s → %s does NOT fire', (before, after) => {
    expect(diffRecoveredTargets(snap(before), snap(after))).toEqual([]);
  });

  test('variable product fires only for the variant that recovered', () => {
    const before = snap('out', { v1: 'out', v2: 'in', v3: 'out' });
    const after = snap('in', { v1: 'in', v2: 'in', v3: 'out' });
    expect(diffRecoveredTargets(before, after)).toEqual(['v1']);
  });

  test('a newly added variant (absent before) never fires', () => {
    const before = snap('out', { v1: 'out' });
    const after = snap('in', { v1: 'out', v2: 'in' });
    expect(diffRecoveredTargets(before, after)).toEqual([]);
  });

  test('a variable product never fires the whole-item (null) target', () => {
    const before = snap('out', { v1: 'out' });
    const after = snap('in', { v1: 'in' });
    expect(diffRecoveredTargets(before, after)).toEqual(['v1']); // not [null, 'v1']
  });
});
