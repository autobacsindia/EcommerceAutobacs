/**
 * Payee details (utils/payee.js): an Indian bank by IFSC, a foreign one by SWIFT.
 *
 * What must hold:
 *   - exactly one of IFSC / SWIFT on a bank payee, each in its own format
 *   - a foreign account may be an IBAN; an Indian one is digits only
 *   - the "same account" key of an IFSC payee is what it always was, so payments
 *     raised before SWIFT still group with new ones to the same account
 */
import { bankCodeLabel, cleanPayee, payKeyOf, SWIFT } from '../utils/payee.js';

const INDIAN = { name: 'ARB Supplies', method: 'bank', accountName: 'ARB Supplies Pvt Ltd', accountNumber: '123456789012', ifsc: 'HDFC0001234' };
const THAI = { name: 'Open N', method: 'bank', accountName: 'Nikom Amranan', accountNumber: '8582102601', swift: 'KASITHBK', bankName: 'KASIKORNBANK' };

describe('payee bank codes', () => {
  it('takes an IFSC for an Indian bank, as before', () => {
    expect(cleanPayee(INDIAN)).toMatchObject({ ifsc: 'HDFC0001234', swift: '', accountNumber: '123456789012' });
  });

  it('takes a SWIFT code for a foreign bank, upper-cased, spaces dropped', () => {
    expect(cleanPayee({ ...THAI, swift: ' kasi thbk ' })).toMatchObject({ swift: 'KASITHBK', ifsc: '' });
    expect(cleanPayee({ ...THAI, swift: 'KASITHBK001' }).swift).toBe('KASITHBK001');
  });

  it('refuses a malformed SWIFT, both codes at once, and neither', () => {
    for (const swift of ['KASI', 'KASITHB', 'KASITHBK0', 'KASITHBK0012', '12SITHBK', 'KASI1HBK']) {
      expect([swift, SWIFT.test(swift)]).toEqual([swift, false]);
      expect(() => cleanPayee({ ...THAI, swift })).toThrow(/SWIFT/);
    }
    expect(() => cleanPayee({ ...THAI, ifsc: 'HDFC0001234' })).toThrow(/not both/);
    expect(() => cleanPayee({ ...THAI, swift: '' })).toThrow(/IFSC/);
  });

  it('a foreign account may be an IBAN; an Indian account is digits only', () => {
    expect(cleanPayee({ ...THAI, accountNumber: 'de89 3704 0044 0532 0130 00' }).accountNumber).toBe('DE89370400440532013000');
    expect(() => cleanPayee({ ...THAI, accountNumber: 'AB' })).toThrow(/IBAN/);
    expect(() => cleanPayee({ ...INDIAN, accountNumber: 'DE8937040044' })).toThrow(/6–18 digits/);
  });

  it('keeps the old "same account" key for IFSC payees, and keys SWIFT payees by their code', () => {
    expect(payKeyOf(INDIAN)).toBe('bank:123456789012:HDFC0001234');
    expect(payKeyOf({ ...INDIAN, swift: '' })).toBe('bank:123456789012:HDFC0001234');
    expect(payKeyOf(THAI)).toBe('bank:8582102601:KASITHBK');
    expect(payKeyOf(THAI)).not.toBe(payKeyOf({ ...THAI, swift: 'BKKBTHBK' }));
  });

  it('labels the code for chat and lists', () => {
    expect(bankCodeLabel(INDIAN)).toBe('IFSC HDFC0001234');
    expect(bankCodeLabel(THAI)).toBe('SWIFT KASITHBK');
    expect(bankCodeLabel({})).toBe('');
  });
});
