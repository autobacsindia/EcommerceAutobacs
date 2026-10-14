import { MAX_ADDRESSES, AddressBookError, normaliseAddressBook, normalisePhone } from '../../../utils/addressBook.js';

const addr = (over = {}) => ({
  fullName: 'Tanveer Singh',
  phone: '9876543210',
  addressLine1: '12 MG Road',
  city: 'Kochi',
  state: 'Kerala',
  postalCode: '682001',
  ...over,
});

describe('normalisePhone', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['098765-43210', '9876543210'],
  ])('%s → %s', (raw, out) => expect(normalisePhone(raw)).toBe(out));

  it.each(['12345', '1234567890', 'abcdefghij', ''])('rejects %s', (raw) => {
    // 1234567890 starts with 1: not a valid Indian mobile.
    expect(normalisePhone(raw)).toBeNull();
  });
});

describe('normaliseAddressBook', () => {
  it('accepts a valid address and fixes the country', () => {
    const [a] = normaliseAddressBook([addr()]);
    expect(a).toMatchObject({ fullName: 'Tanveer Singh', postalCode: '682001', country: 'India' });
  });

  it('makes the first address the default when none is marked', () => {
    const out = normaliseAddressBook([addr(), addr({ city: 'Kollam' })]);
    expect(out.map((a) => a.isDefault)).toEqual([true, false]);
  });

  it('keeps exactly one default when several are marked', () => {
    const out = normaliseAddressBook([addr(), addr({ isDefault: true }), addr({ isDefault: true })]);
    expect(out.map((a) => a.isDefault)).toEqual([false, true, false]);
  });

  it('drops fields it does not know, so a client cannot write arbitrary keys', () => {
    const [a] = normaliseAddressBook([addr({ role: 'admin', coordinates: { type: 'Point' } })]);
    expect(a.role).toBeUndefined();
    expect(a.coordinates).toBeUndefined();
  });

  it('does not invent ids — addresses are identified by their contents', () => {
    const [a] = normaliseAddressBook([addr({ _id: '6a312b697575611b20a0c56b' })]);
    expect(a._id).toBeUndefined();
  });

  it.each([
    [{ postalCode: '68200' }, /PIN code/],
    [{ phone: '123' }, /10-digit mobile/],
    [{ city: '  ' }, /City is required/],
    [{ fullName: '' }, /Full name is required/],
  ])('rejects %o with a message the customer can act on', (over, msg) => {
    expect(() => normaliseAddressBook([addr(over)])).toThrow(msg);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_ADDRESSES + 1 }, () => addr());
    expect(() => normaliseAddressBook(many)).toThrow(AddressBookError);
  });

  it('accepts an empty list — deleting every address is allowed', () => {
    expect(normaliseAddressBook([])).toEqual([]);
  });

  it('rejects something that is not a list', () => {
    expect(() => normaliseAddressBook({ 0: addr() })).toThrow(AddressBookError);
  });
});
