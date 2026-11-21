/**
 * Card as a way to pay, and optional pay details on expense requests (utils/payee.js).
 *
 * What must hold:
 *   - a card is only ever its last 4 digits (PCI DSS): a full number is refused
 *     for every method, and the message never repeats it
 *   - `optional` (expenses): any detail may be blank, but what is typed is checked
 *   - without `optional` (suppliers): the rules are what they were — card refused
 *   - card / no-method payees are never grouped into one transfer
 */
import { cardLabelOf, cleanCardLast4, cleanPayee, LAST4_ONLY, methodLabel, payKeyOf } from '../utils/payee.js';

const CARD = { name: 'Claude', method: 'card', cardType: 'credit', cardNetwork: 'visa', cardLast4: '4821', cardName: 'Sachin', cardLabel: 'HDFC corporate card' };
const opt = { optional: true };

describe('card payee', () => {
  it('keeps type, network, last 4, name on card and the nickname', () => {
    expect(cleanPayee(CARD, opt)).toEqual({
      name: 'Claude', method: 'card', phone: '', cardType: 'credit', cardNetwork: 'visa', cardLast4: '4821', cardName: 'Sachin', cardLabel: 'HDFC corporate card',
    });
    expect(cardLabelOf(CARD)).toBe('Visa credit ••••4821 · HDFC corporate card');
    expect(methodLabel('card')).toBe('Card');
  });

  it('every card field is optional', () => {
    expect(cleanPayee({ method: 'card' }, opt)).toMatchObject({ method: 'card', cardType: '', cardNetwork: '', cardLast4: '', cardName: '', cardLabel: '' });
  });

  it('refuses a full card number, however it is typed, without echoing it', () => {
    for (const n of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', '41111', '378282246310005']) {
      let err;
      try { cleanPayee({ ...CARD, cardLast4: n }, opt); } catch (e) { err = e; }
      expect(err?.message).toBe(LAST4_ONLY);
      expect(err.statusCode).toBe(400);
      expect(err.message).not.toContain(n.replace(/\D/g, '').slice(0, 6));
    }
    // A card number sent beside UPI or bank is refused too, never silently dropped.
    expect(() => cleanPayee({ name: 'X Y', method: 'upi', upiId: 'a@okaxis', cardLast4: '4111111111111111' }, opt)).toThrow(LAST4_ONLY);
    expect(() => cleanPayee({ name: 'X Y', method: 'upi', upiId: 'a@okaxis', cardLast4: '4111111111111111' })).toThrow(LAST4_ONLY);
  });

  it('last 4 is exactly 4 digits', () => {
    expect(cleanCardLast4(' 0042 ')).toBe('0042');
    expect(cleanCardLast4('')).toBe('');
    expect(() => cleanCardLast4('482')).toThrow(/exactly the last 4/);
    expect(() => cleanCardLast4('48a1')).toThrow(/exactly the last 4/);
    expect(() => cleanCardLast4('', { required: true })).toThrow(/last 4/);
  });

  it('refuses an unknown card type or network', () => {
    expect(() => cleanPayee({ ...CARD, cardType: 'prepaid' }, opt)).toThrow(/credit or debit/);
    expect(() => cleanPayee({ ...CARD, cardNetwork: 'diners' }, opt)).toThrow(/Visa/);
  });

  it('card fields are not stored on a UPI or bank payee', () => {
    const p = cleanPayee({ name: 'Fuel', method: 'upi', upiId: 'fuel@okaxis', cardLast4: '4821', cardLabel: 'x' }, opt);
    expect(p).not.toHaveProperty('cardLast4');
    expect(p).not.toHaveProperty('cardLabel');
  });

  it('supplier payees (not optional) cannot be card', () => {
    expect(() => cleanPayee(CARD)).toThrow('Choose UPI or bank transfer.');
  });
});

describe('optional pay details (expense requests)', () => {
  it('nothing at all is accepted', () => {
    expect(cleanPayee({}, opt)).toEqual({ name: '', method: '', phone: '' });
    expect(cleanPayee({ name: '  ', method: '' }, opt)).toEqual({ name: '', method: '', phone: '' });
  });

  it('a method with no details is accepted', () => {
    expect(cleanPayee({ method: 'upi' }, opt)).toMatchObject({ method: 'upi', upiId: '' });
    expect(cleanPayee({ method: 'bank' }, opt)).toMatchObject({ method: 'bank', accountNumber: '', ifsc: '', swift: '', accountName: '' });
    expect(cleanPayee({ method: 'bank', accountNumber: '123456789012' }, opt).accountNumber).toBe('123456789012');
    expect(cleanPayee({ method: 'bank', accountNumber: 'de89 3704 0044 0532 0130 00' }, opt).accountNumber).toBe('DE89370400440532013000');
    expect(cleanPayee({ method: 'bank', ifsc: 'hdfc0001234' }, opt).ifsc).toBe('HDFC0001234');
  });

  it('what IS typed is still checked', () => {
    expect(() => cleanPayee({ method: 'bank', ifsc: 'HDFC123' }, opt)).toThrow(/IFSC/);
    expect(() => cleanPayee({ method: 'bank', swift: 'KASI' }, opt)).toThrow(/SWIFT/);
    expect(() => cleanPayee({ method: 'bank', ifsc: 'HDFC0001234', accountNumber: '12AB' }, opt)).toThrow(/6–18 digits/);
    expect(() => cleanPayee({ method: 'bank', accountNumber: '1!' }, opt)).toThrow(/account number/);
    expect(() => cleanPayee({ method: 'bank', ifsc: 'HDFC0001234', swift: 'KASITHBK' }, opt)).toThrow(/not both/);
    expect(() => cleanPayee({ method: 'upi', upiId: 'nope' }, opt)).toThrow(/UPI ID/);
    expect(() => cleanPayee({ method: 'cash' }, opt)).toThrow('Choose UPI, bank transfer or card.');
    expect(() => cleanPayee({ name: 'X' }, opt)).toThrow(/who is being paid/);
  });

  it('without `optional` the old rules stand', () => {
    expect(() => cleanPayee({})).toThrow(/who is being paid/);
    expect(() => cleanPayee({ name: 'ARB' })).toThrow('Choose UPI or bank transfer.');
    expect(() => cleanPayee({ name: 'ARB', method: 'bank', ifsc: 'HDFC0001234' })).toThrow(/account number/);
  });
});

describe('paying in one transfer', () => {
  it('card and no-method payees each stand alone; a changed card is a changed key', () => {
    expect(payKeyOf({ method: 'card', cardLast4: '4821' }, 'a')).not.toBe(payKeyOf({ method: 'card', cardLast4: '4821' }, 'b'));
    expect(payKeyOf({ method: '' }, 'a')).not.toBe(payKeyOf({ method: '' }, 'b'));
    expect(payKeyOf({ method: 'card', cardLast4: '4821' }, 'x')).not.toBe(payKeyOf({ method: 'card', cardLast4: '1234' }, 'x'));
    expect(payKeyOf({ method: 'upi', upiId: 'A@okaxis' }, 'a')).toBe('upi:a@okaxis');
  });
});
