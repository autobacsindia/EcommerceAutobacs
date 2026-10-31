import { PAYMENT_METHODS } from '@/lib/constants';

/**
 * What the shopper picks on the checkout payment step.
 *
 * Both choices are the SAME Razorpay payment: the order is recorded with
 * `paymentMethod: 'razorpay'` either way, and the amount is the server-computed order
 * total either way. The only difference is which section the Razorpay window opens on.
 *
 * Why EMI is its own choice: the Razorpay window always listed EMI (the live account has
 * credit- and debit-card EMI from 16 banks), but our payment step offered a single
 * "Razorpay (Card/UPI/Wallet)" option that never mentioned it. Shoppers — and the owner —
 * concluded the store had no EMI. A visible choice that opens Razorpay straight on its EMI
 * section fixes that without touching how the payment is created, verified or fulfilled.
 */
export const PAYMENT_CHOICES = {
  RAZORPAY: 'razorpay',
  RAZORPAY_EMI: 'razorpay_emi',
} as const;

export type PaymentChoice = (typeof PAYMENT_CHOICES)[keyof typeof PAYMENT_CHOICES];

export const PAYMENT_CHOICE_LABELS: Record<PaymentChoice, string> = {
  [PAYMENT_CHOICES.RAZORPAY]: 'Card, UPI, Netbanking or Wallet',
  [PAYMENT_CHOICES.RAZORPAY_EMI]: 'EMI — pay monthly on your card',
};

/**
 * Razorpay Standard Checkout `prefill.method` values we use. `emi` opens the window on
 * its EMI section (credit-card / debit-card EMI by bank). The shopper can still switch
 * to any other method inside the window.
 */
export type RazorpayStartMethod = 'emi';

/** The method recorded on the order. Always Razorpay — never trust the UI choice for more. */
export function paymentMethodForChoice(_choice: PaymentChoice): typeof PAYMENT_METHODS.RAZORPAY {
  return PAYMENT_METHODS.RAZORPAY;
}

/** Which section the Razorpay window should open on, or undefined for Razorpay's default. */
export function razorpayStartMethodForChoice(choice: PaymentChoice): RazorpayStartMethod | undefined {
  return choice === PAYMENT_CHOICES.RAZORPAY_EMI ? 'emi' : undefined;
}

export function isPaymentChoice(value: string): value is PaymentChoice {
  return (Object.values(PAYMENT_CHOICES) as string[]).includes(value);
}
