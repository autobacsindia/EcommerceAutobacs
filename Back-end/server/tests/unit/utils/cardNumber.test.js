import { containsCardNumber, luhnValid } from '../../../utils/cardNumber.js';

describe('containsCardNumber', () => {
  it.each([
    '4111111111111111',
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    'card: 5500 0055 5555 5559 exp 12/28',
    '378282246310005', // Amex, 15 digits
    '6011111111111117',
  ])('flags %s', (t) => expect(containsCardNumber(t)).toBe(true));

  it.each([
    '',
    null,
    'last 4: 4007',
    'Call +91 98765 43210',
    'invoice 1234567890123',
    '4111 1111 1111 1112', // fails the check digit
    '12345678901234567890123', // longer than any card
    'GSTIN 29ABCDE1234F1Z5',
  ])('leaves %s alone', (t) => expect(containsCardNumber(t)).toBe(false));

  it('luhn', () => {
    expect(luhnValid('79927398713')).toBe(true);
    expect(luhnValid('79927398710')).toBe(false);
  });
});
