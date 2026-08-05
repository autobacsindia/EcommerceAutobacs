/**
 * Payment-method normalization: the mapping that decides what the admin payment mix
 * reports and whether a refund is allowed to be partial.
 */

import {
  resolvePaymentMethod,
  buildMethodDetails,
  supportsPartialRefund,
  describeEmiPlan,
} from '../../../utils/paymentMethodDetails.js';

describe('resolvePaymentMethod', () => {
  it('splits debit from credit on card.type (the bug: Razorpay never sends "debitcard")', () => {
    expect(resolvePaymentMethod({ method: 'card', card: { type: 'debit' } })).toBe('debit_card');
    expect(resolvePaymentMethod({ method: 'card', card: { type: 'credit' } })).toBe('credit_card');
  });

  it('falls back to credit_card when a card carries no type, matching the old behaviour', () => {
    expect(resolvePaymentMethod({ method: 'card' })).toBe('credit_card');
  });

  it('maps prepaid cards to wallet', () => {
    expect(resolvePaymentMethod({ method: 'card', card: { type: 'prepaid' } })).toBe('wallet');
  });

  it('maps the plain methods', () => {
    expect(resolvePaymentMethod({ method: 'upi' })).toBe('upi');
    expect(resolvePaymentMethod({ method: 'netbanking' })).toBe('net_banking');
    expect(resolvePaymentMethod({ method: 'wallet' })).toBe('wallet');
    expect(resolvePaymentMethod({ method: 'emi' })).toBe('emi');
  });

  it('buckets cardless EMI as emi rather than losing it to "other"', () => {
    expect(resolvePaymentMethod({ method: 'cardless_emi', provider: 'zestmoney' })).toBe('emi');
  });

  it('degrades unknown methods to the "other" enum value, never the raw string', () => {
    // An out-of-enum value would throw Mongoose validation inside the payment
    // transaction and strand a captured payment as unrecorded.
    expect(resolvePaymentMethod({ method: 'paylater' })).toBe('other');
    expect(resolvePaymentMethod({ method: 'bank_transfer' })).toBe('other');
    expect(resolvePaymentMethod({})).toBe('other');
    expect(resolvePaymentMethod(null)).toBe('other');
  });

  it('still accepts a bare method string for older callers', () => {
    expect(resolvePaymentMethod('upi')).toBe('upi');
    expect(resolvePaymentMethod('card')).toBe('credit_card');
  });
});

describe('buildMethodDetails', () => {
  it('captures card facts', () => {
    const details = buildMethodDetails({
      method: 'card',
      card: { network: 'Visa', type: 'debit', issuer: 'HDFC', last4: '1234' },
    });
    expect(details).toEqual({
      rawMethod: 'card',
      cardNetwork: 'Visa',
      cardType: 'debit',
      cardIssuer: 'HDFC',
      cardLast4: '1234',
    });
  });

  it('omits absent fields instead of writing nulls', () => {
    expect(buildMethodDetails({ method: 'upi' })).toEqual({ rawMethod: 'upi' });
  });

  it('classifies credit-card EMI and converts the basis-point rate', () => {
    const details = buildMethodDetails({
      method: 'emi',
      card: { type: 'credit', issuer: 'HDFC', last4: '4321' },
      emi_plan: { issuer: 'HDFC', type: 'credit', rate: 1400, duration: 6 },
    });
    expect(details.emi).toEqual({ kind: 'credit_card', issuer: 'HDFC', months: 6, ratePercent: 14 });
  });

  it('classifies debit-card EMI — the case that governs refunds', () => {
    const details = buildMethodDetails({
      method: 'emi',
      card: { type: 'debit', issuer: 'ICICI' },
    });
    expect(details.emi.kind).toBe('debit_card');
    expect(details.emi.issuer).toBe('ICICI');
  });

  it('classifies cardless EMI and takes the lender from provider', () => {
    const details = buildMethodDetails({ method: 'cardless_emi', provider: 'zestmoney' });
    expect(details.emi).toEqual({ kind: 'cardless', issuer: 'zestmoney' });
  });

  it('marks EMI kind unknown when the payload carries no card type', () => {
    expect(buildMethodDetails({ method: 'emi' }).emi.kind).toBe('unknown');
  });

  it('treats a rate already expressed as a percentage as one', () => {
    const details = buildMethodDetails({ method: 'emi', emi_plan: { rate: 13, duration: 3 } });
    expect(details.emi.ratePercent).toBe(13);
  });

  it('drops a zero/absent rate and a zero tenure rather than rendering "0 months @ 0%"', () => {
    const details = buildMethodDetails({ method: 'emi', emi_plan: { rate: 0, duration: 0 } });
    expect(details.emi.ratePercent).toBeUndefined();
    expect(details.emi.months).toBeUndefined();
  });

  it('adds no emi block to non-EMI payments', () => {
    expect(buildMethodDetails({ method: 'upi' }).emi).toBeUndefined();
  });
});

describe('supportsPartialRefund', () => {
  it('blocks partial refunds on debit-card EMI (issuer can only unwind the whole loan)', () => {
    expect(supportsPartialRefund({ methodDetails: { emi: { kind: 'debit_card' } } })).toBe(false);
  });

  it('allows partial refunds on credit-card and cardless EMI', () => {
    expect(supportsPartialRefund({ methodDetails: { emi: { kind: 'credit_card' } } })).toBe(true);
    expect(supportsPartialRefund({ methodDetails: { emi: { kind: 'cardless' } } })).toBe(true);
  });

  it('allows unknown-kind EMI — must not block a legitimate refund on missing metadata', () => {
    expect(supportsPartialRefund({ methodDetails: { emi: { kind: 'unknown' } } })).toBe(true);
  });

  it('allows every non-EMI payment, including rows with no methodDetails at all', () => {
    expect(supportsPartialRefund({ methodDetails: { rawMethod: 'upi' } })).toBe(true);
    expect(supportsPartialRefund({})).toBe(true);
    expect(supportsPartialRefund(null)).toBe(true);
  });
});

describe('describeEmiPlan', () => {
  it('renders the full plan', () => {
    expect(
      describeEmiPlan({ methodDetails: { emi: { kind: 'credit_card', issuer: 'HDFC', months: 6, ratePercent: 14 } } })
    ).toBe('Credit Card EMI · HDFC · 6 months @ 14%');
  });

  it('omits the rate when only the tenure is known', () => {
    expect(describeEmiPlan({ methodDetails: { emi: { kind: 'debit_card', issuer: 'ICICI', months: 3 } } }))
      .toBe('Debit Card EMI · ICICI · 3 months');
  });

  it('degrades to the kind alone', () => {
    expect(describeEmiPlan({ methodDetails: { emi: { kind: 'unknown' } } })).toBe('EMI');
  });

  it('returns undefined for non-EMI payments so callers can skip rendering', () => {
    expect(describeEmiPlan({ methodDetails: { rawMethod: 'upi' } })).toBeUndefined();
    expect(describeEmiPlan(null)).toBeUndefined();
  });
});
