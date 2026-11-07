import { normalizeShippingSize, hasCompleteShippingSize, SHIPPING_SIZE_LIMITS } from '../../../utils/shippingSize.js';

describe('normalizeShippingSize', () => {
  test('non-objects leave the stored size untouched (undefined)', () => {
    for (const v of [undefined, null, '', 'abc', 5, ['1']]) expect(normalizeShippingSize(v)).toBeUndefined();
  });

  test('blank → null, numeric strings → numbers, numbers kept', () => {
    expect(normalizeShippingSize({ weightKg: ' 1.25 ', lengthCm: '', breadthCm: null, heightCm: 12 }))
      .toEqual({ weightKg: 1.25, lengthCm: null, breadthCm: null, heightCm: 12 });
  });

  test('invalid values pass through so the schema rejects them (no silent drop)', () => {
    expect(normalizeShippingSize({ weightKg: 'abc', lengthCm: '-3' })).toMatchObject({ weightKg: 'abc', lengthCm: '-3' });
  });

  test('unknown keys are dropped', () => {
    expect(Object.keys(normalizeShippingSize({ weightKg: 1, foo: 2 }))).toEqual(['weightKg', 'lengthCm', 'breadthCm', 'heightCm']);
  });
});

describe('hasCompleteShippingSize', () => {
  test('needs all four positive numbers', () => {
    expect(hasCompleteShippingSize({ weightKg: 1, lengthCm: 1, breadthCm: 1, heightCm: 1 })).toBe(true);
    expect(hasCompleteShippingSize({ weightKg: 1, lengthCm: 1, breadthCm: 1, heightCm: null })).toBe(false);
    expect(hasCompleteShippingSize(null)).toBe(false);
  });
});

test('limits match the frontend editor copy', () => {
  expect(SHIPPING_SIZE_LIMITS).toEqual({
    weightKg: { min: 0.01, max: 500 },
    lengthCm: { min: 0.5, max: 400 },
    breadthCm: { min: 0.5, max: 400 },
    heightCm: { min: 0.5, max: 400 },
  });
});
