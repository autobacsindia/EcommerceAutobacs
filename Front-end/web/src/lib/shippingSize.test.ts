import {
  EMPTY_SHIPPING_SIZE,
  SHIPPING_SIZE_LIMITS,
  chargeableWeightKg,
  firstShippingSizeError,
  shippingSizeError,
  shippingSizeToForm,
  shippingSizeToPayload,
} from './shippingSize';

describe('shippingSize helpers', () => {
  it('limits match Back-end/server/utils/shippingSize.js', () => {
    expect(SHIPPING_SIZE_LIMITS).toEqual({
      weightKg: { min: 0.01, max: 500 },
      lengthCm: { min: 0.5, max: 400 },
      breadthCm: { min: 0.5, max: 400 },
      heightCm: { min: 0.5, max: 400 },
    });
  });

  it('stored size ↔ form round-trips; null/missing become blank', () => {
    const form = shippingSizeToForm({ weightKg: 2.5, lengthCm: null });
    expect(form).toEqual({ weightKg: '2.5', lengthCm: '', breadthCm: '', heightCm: '' });
    expect(shippingSizeToForm(undefined)).toEqual(EMPTY_SHIPPING_SIZE);
    expect(shippingSizeToPayload(form)).toEqual({ weightKg: 2.5, lengthCm: null, breadthCm: null, heightCm: null });
  });

  it.each([
    ['weightKg', '', null],
    ['weightKg', '1.2', null],
    ['weightKg', '0', 'At least 0.01 kg'],
    ['weightKg', '2500', 'At most 500 kg — typed grams by mistake?'],
    ['lengthCm', '500', 'At most 400 cm'],
    ['heightCm', 'abc', 'Numbers only'],
  ] as const)('%s = %j → %j', (key, raw, expected) => {
    expect(shippingSizeError(key, raw)).toBe(expected);
  });

  it('firstShippingSizeError names the field', () => {
    expect(firstShippingSizeError({ ...EMPTY_SHIPPING_SIZE, breadthCm: '-1' })).toBe('Width (cm): At least 0.5 cm');
    expect(firstShippingSizeError(EMPTY_SHIPPING_SIZE)).toBeNull();
  });

  it('chargeable weight is the larger of dead and volumetric (L×B×H/5000)', () => {
    // Roof box: 18 kg, 190×80×40 → 121.6 kg volumetric
    expect(chargeableWeightKg({ weightKg: '18', lengthCm: '190', breadthCm: '80', heightCm: '40' })).toBe(121.6);
    // Dense battery: 15 kg, 25×18×20 → 1.8 kg volumetric
    expect(chargeableWeightKg({ weightKg: '15', lengthCm: '25', breadthCm: '18', heightCm: '20' })).toBe(15);
    expect(chargeableWeightKg({ ...EMPTY_SHIPPING_SIZE, weightKg: '5' })).toBeNull();
  });
});
