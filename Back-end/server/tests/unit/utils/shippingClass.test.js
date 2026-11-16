import {
  SHIPPING_CLASSES,
  chargeableWeightKg,
  boxFromListedSize,
  classForChargeableKg,
  suggestShippingClass,
  parseShippingClassInput,
  resolveShippingClass,
  isValidClassBoxes,
  DEFAULT_CLASS_BOXES,
} from '../../../utils/shippingClass.js';
import { normalizeListedSize } from '../../../utils/shippingSize.js';

const box = (weightKg, lengthCm, breadthCm, heightCm) => ({ weightKg, lengthCm, breadthCm, heightCm });

describe('chargeableWeightKg', () => {
  test('dead weight wins when the box is small for its weight', () => {
    expect(chargeableWeightKg(box(8, 20, 20, 20))).toBe(8); // volumetric 1.6
  });
  test('volumetric wins when the box is big for its weight', () => {
    expect(chargeableWeightKg(box(3, 50, 40, 30))).toBe(12); // 60000 / 5000
  });
  test.each([[null], [undefined], [box(1, 10, 10, null)], [box(0, 10, 10, 10)], [box('2', 10, 10, 10)]])(
    'incomplete or invalid size → null (%p)', (size) => {
      expect(chargeableWeightKg(size)).toBeNull();
    },
  );
});

describe('classForChargeableKg — boundaries are inclusive', () => {
  test.each([
    [0.01, 'small'], [2, 'small'], [2.0001, 'medium'],
    [10, 'medium'], [10.01, 'large'],
    [30, 'large'], [30.01, 'xl'], [499, 'xl'],
  ])('%p kg → %s', (kg, cls) => {
    expect(classForChargeableKg(kg)).toBe(cls);
  });
  test.each([[0], [-1], [NaN], [null], ['5']])('no class for %p', (kg) => {
    expect(classForChargeableKg(kg)).toBeNull();
  });
});

describe('boxFromListedSize', () => {
  test('adds 5 cm a side and 10% to the weight', () => {
    const b = boxFromListedSize(box(1.5, 40, 15, 15));
    expect(b.lengthCm).toBe(45);
    expect(b.breadthCm).toBe(20);
    expect(b.heightCm).toBe(20);
    expect(b.weightKg).toBeCloseTo(1.65);
  });
  test('incomplete → null', () => {
    expect(boxFromListedSize(box(1, 10, null, 10))).toBeNull();
  });
});

describe('suggestShippingClass', () => {
  test('a car vacuum listed online at 40×15×15, 1.5 kg is Medium: its box is charged by size', () => {
    // box 45×20×20 = 3.6 kg volumetric > 2 → Medium. The allowance matters.
    expect(suggestShippingClass({ listedSize: box(1.5, 40, 15, 15) })).toBe('medium');
    // a smaller one, 25×10×10: box 30×15×15 = 1.35 kg → Small
    expect(suggestShippingClass({ listedSize: box(0.8, 25, 10, 10) })).toBe('small');
  });
  test('the measured packed box beats the online size', () => {
    expect(suggestShippingClass({ shippingSize: box(25, 60, 50, 40), listedSize: box(0.5, 10, 10, 10) })).toBe('large');
  });
  test('an incomplete packed box falls back to the online size', () => {
    expect(suggestShippingClass({ shippingSize: box(25, null, null, null), listedSize: box(0.5, 10, 10, 10) })).toBe('small');
  });
  test('a 400 L roof box listed at 160×80×40, 15 kg is XL (volumetric ~118 kg)', () => {
    expect(suggestShippingClass({ listedSize: box(15, 160, 80, 40) })).toBe('xl');
  });
  test('no complete size → null', () => {
    expect(suggestShippingClass({})).toBeNull();
    expect(suggestShippingClass()).toBeNull();
  });
});

describe('parseShippingClassInput', () => {
  test('not sent → undefined', () => expect(parseShippingClassInput(undefined)).toBeUndefined());
  test.each([[null], [''], ['  '], ['auto'], ['AUTO']])('%p → auto', (v) => {
    expect(parseShippingClassInput(v)).toBe('auto');
  });
  test.each(SHIPPING_CLASSES.flatMap((c) => [[c, c], [` ${c.toUpperCase()} `, c]]))('%p → %s', (v, out) => {
    expect(parseShippingClassInput(v)).toBe(out);
  });
  test.each([['huge'], ['extra large'], [3], [{}], [['small']], [true]])('rejects %p', (v) => {
    expect(() => parseShippingClassInput(v)).toThrow(TypeError);
  });
});

describe('resolveShippingClass', () => {
  const sizes = { listedSize: box(0.8, 25, 10, 10) }; // → small

  test('a chosen class is manual, whatever the sizes say', () => {
    expect(resolveShippingClass({ requested: 'xl', current: null, sizes }))
      .toEqual({ shippingClass: 'xl', shippingClassSource: 'manual' });
  });
  test('not sent + a manual class stored → the choice is kept even if sizes changed', () => {
    const current = { shippingClass: 'large', shippingClassSource: 'manual' };
    expect(resolveShippingClass({ requested: undefined, current, sizes }))
      .toEqual({ shippingClass: 'large', shippingClassSource: 'manual' });
  });
  test('not sent + auto stored → re-suggested from the new sizes', () => {
    const current = { shippingClass: 'large', shippingClassSource: 'auto' };
    expect(resolveShippingClass({ requested: undefined, current, sizes }))
      .toEqual({ shippingClass: 'small', shippingClassSource: 'auto' });
  });
  test('"Automatic" over a manual class → back to the suggestion', () => {
    const current = { shippingClass: 'large', shippingClassSource: 'manual' };
    expect(resolveShippingClass({ requested: 'auto', current, sizes }))
      .toEqual({ shippingClass: 'small', shippingClassSource: 'auto' });
  });
  test('"Automatic" with no sizes → not set (null, null), never a guess', () => {
    expect(resolveShippingClass({ requested: 'auto', current: null, sizes: {} }))
      .toEqual({ shippingClass: null, shippingClassSource: null });
  });
});

describe('isValidClassBoxes', () => {
  test('the defaults are valid', () => expect(isValidClassBoxes(DEFAULT_CLASS_BOXES)).toBe(true));
  test('a missing box is not', () => {
    expect(isValidClassBoxes({ small: DEFAULT_CLASS_BOXES.small, medium: DEFAULT_CLASS_BOXES.medium })).toBe(false);
  });
});

describe('normalizeListedSize', () => {
  test('non-objects → undefined (keep stored)', () => {
    for (const v of [undefined, null, 'x', 3, []]) expect(normalizeListedSize(v)).toBeUndefined();
  });
  test('numbers coerced, link trimmed, estimated parsed', () => {
    expect(normalizeListedSize({ weightKg: '1.5', lengthCm: 40, breadthCm: '15', heightCm: 15, sourceUrl: '  https://amazon.in/x  ', estimated: 'Yes' }))
      .toEqual({ weightKg: 1.5, lengthCm: 40, breadthCm: 15, heightCm: 15, sourceUrl: 'https://amazon.in/x', estimated: true });
  });
  test('blank link → null; anything but a yes → not estimated', () => {
    const out = normalizeListedSize({ sourceUrl: '', estimated: 'no' });
    expect(out.sourceUrl).toBeNull();
    expect(out.estimated).toBe(false);
    expect(normalizeListedSize({ estimated: 'maybe' }).estimated).toBe(false);
  });
});
