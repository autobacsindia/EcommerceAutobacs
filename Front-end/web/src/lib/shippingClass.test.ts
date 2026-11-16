import {
  classForChargeableKg,
  suggestShippingClass,
  shippingClassToChoice,
  listedSizeToForm,
  listedSizeToPayload,
  firstListedSizeError,
  EMPTY_LISTED_SIZE,
} from './shippingClass';
import { EMPTY_SHIPPING_SIZE } from './shippingSize';

const form = (w: string, l: string, b: string, h: string) => ({ weightKg: w, lengthCm: l, breadthCm: b, heightCm: h });

describe('classForChargeableKg (mirrors the server)', () => {
  it.each([[2, 'small'], [2.01, 'medium'], [10, 'medium'], [10.5, 'large'], [30, 'large'], [30.1, 'xl']])('%p kg → %s', (kg, c) => {
    expect(classForChargeableKg(kg)).toBe(c);
  });
  it('no class for nothing', () => {
    expect(classForChargeableKg(null)).toBeNull();
    expect(classForChargeableKg(0)).toBeNull();
  });
});

describe('suggestShippingClass', () => {
  it('online 40×15×15, 1.5 kg → Medium once packed (45×20×20 = 3.6 kg)', () => {
    expect(suggestShippingClass(EMPTY_SHIPPING_SIZE, form('1.5', '40', '15', '15'))).toBe('medium');
  });
  it('a measured packed box beats the online size', () => {
    expect(suggestShippingClass(form('25', '60', '50', '40'), form('0.5', '10', '10', '10'))).toBe('large');
  });
  it('nothing complete → null', () => {
    expect(suggestShippingClass(EMPTY_SHIPPING_SIZE, form('1', '', '', ''))).toBeNull();
  });
});

describe('form ↔ payload', () => {
  it('only a manual class shows as fixed in the dropdown', () => {
    expect(shippingClassToChoice('large', 'manual')).toBe('large');
    expect(shippingClassToChoice('large', 'auto')).toBe('');
    expect(shippingClassToChoice(null, null)).toBe('');
  });
  it('round-trips the online size; blank link → null', () => {
    const f = listedSizeToForm({ weightKg: 1.5, lengthCm: 40, breadthCm: 15, heightCm: 15, sourceUrl: 'https://x.in/a', estimated: true });
    expect(f).toEqual({ weightKg: '1.5', lengthCm: '40', breadthCm: '15', heightCm: '15', sourceUrl: 'https://x.in/a', estimated: true });
    expect(listedSizeToPayload({ ...f, sourceUrl: '  ' })).toEqual({ weightKg: 1.5, lengthCm: 40, breadthCm: 15, heightCm: 15, sourceUrl: null, estimated: true });
  });
  it('blocks save on a bad link or number', () => {
    expect(firstListedSizeError(EMPTY_LISTED_SIZE)).toBeNull();
    expect(firstListedSizeError({ ...EMPTY_LISTED_SIZE, sourceUrl: 'ftp://x' })).toMatch(/source link/i);
    expect(firstListedSizeError({ ...EMPTY_LISTED_SIZE, weightKg: '9999' })).toMatch(/online size/i);
  });
});
