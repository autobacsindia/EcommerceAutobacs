import { validateCheckoutAddress, firstAddressError } from './addressValidation';
import { isValidIndianMobile, isValidPinCode } from '@/lib/utils';

const ok = { fullName: 'Rahul Menon', street: '12 MG Road', city: 'Kochi', state: 'Kerala', postalCode: '682016', phone: '9876543210' };

describe('validateCheckoutAddress', () => {
  it('passes a complete, real address', () => {
    expect(validateCheckoutAddress(ok)).toEqual({});
  });

  it('flags only the PIN when it is "12" (the audit case)', () => {
    expect(validateCheckoutAddress({ ...ok, postalCode: '12' })).toEqual({ postalCode: 'Enter a valid 6-digit PIN code' });
  });

  it('flags only the phone when extra digits sit in front of a real number', () => {
    expect(validateCheckoutAddress({ ...ok, phone: '1239876543210' })).toEqual({ phone: 'Enter a valid 10-digit mobile number' });
  });

  it('says "enter" (not "invalid") for empty or blank boxes, one message per box', () => {
    const errors = validateCheckoutAddress({ fullName: ' ', street: '', city: '', state: '', postalCode: '', phone: '' });
    expect(Object.keys(errors)).toEqual(['fullName', 'street', 'city', 'state', 'postalCode', 'phone']);
    expect(errors.postalCode).toBe('Enter the PIN code');
    expect(firstAddressError(errors)).toBe('Enter the name of the person receiving the parcel');
  });

  it('reports the first wrong box in form order', () => {
    expect(firstAddressError(validateCheckoutAddress({ ...ok, postalCode: '12', phone: '1' }))).toBe('Enter a valid 6-digit PIN code');
    expect(firstAddressError({})).toBeUndefined();
  });
});

describe('isValidIndianMobile (mirrors the server)', () => {
  it.each(['9876543210', '+91 98765 43210', '919876543210', '09876543210', '98765-43210'])('accepts %s', (p) => {
    expect(isValidIndianMobile(p)).toBe(true);
  });
  it.each(['1239876543210', '5876543210', '987654321', '533201', '9198765432100', ''])('rejects %s', (p) => {
    expect(isValidIndianMobile(p)).toBe(false);
  });
});

describe('isValidPinCode', () => {
  it.each(['682016', ' 682016 '])('accepts "%s"', (p) => expect(isValidPinCode(p)).toBe(true));
  it.each(['12', '6820167', 'ABC123', '682 016', ''])('rejects "%s"', (p) => expect(isValidPinCode(p)).toBe(false));
});
