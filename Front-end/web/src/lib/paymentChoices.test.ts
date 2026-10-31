/**
 * The EMI choice is display-only. Whatever the shopper picks, the order must record the
 * Razorpay method — a UI choice that could change what the backend records (or charges)
 * would be a tampering surface on the money path.
 */
import {
  PAYMENT_CHOICES,
  PAYMENT_CHOICE_LABELS,
  isPaymentChoice,
  paymentMethodForChoice,
  razorpayStartMethodForChoice,
} from './paymentChoices';
import { PAYMENT_METHODS } from './constants';

describe('payment choices', () => {
  it.each(Object.values(PAYMENT_CHOICES))('records the Razorpay method for "%s"', (choice) => {
    expect(paymentMethodForChoice(choice)).toBe(PAYMENT_METHODS.RAZORPAY);
  });

  it('opens Razorpay on its EMI section only for the EMI choice', () => {
    expect(razorpayStartMethodForChoice(PAYMENT_CHOICES.RAZORPAY_EMI)).toBe('emi');
    expect(razorpayStartMethodForChoice(PAYMENT_CHOICES.RAZORPAY)).toBeUndefined();
  });

  it('labels the EMI choice so a shopper can see EMI exists', () => {
    expect(PAYMENT_CHOICE_LABELS[PAYMENT_CHOICES.RAZORPAY_EMI]).toMatch(/\bEMI\b/);
  });

  it('accepts only known choices', () => {
    expect(isPaymentChoice('razorpay')).toBe(true);
    expect(isPaymentChoice('razorpay_emi')).toBe(true);
    expect(isPaymentChoice('cod')).toBe(false);
    expect(isPaymentChoice('')).toBe(false);
  });
});
