import { sourceBadges } from './leads';
import type { LeadSourceType } from './leads';

const lead = (types: LeadSourceType[], primary: LeadSourceType) => ({
  sources: types.map((type) => ({ type })),
  primarySource: primary,
});

describe('sourceBadges — what a row shows under a source filter', () => {
  it('leads with the filtered signal, not the strongest one', () => {
    /*
      The bug the customer reported: filtering to "Left at checkout" listed
      rows badged "Payment failed", because the filter matches ANY signal while
      the badge showed only the strongest. The row was right; the label lied.
    */
    const r = sourceBadges(lead(['payment_pending', 'payment_failed'], 'payment_failed'), 'payment_pending');
    expect(r.lead).toBe('payment_pending');
    expect(r.also).toBe('payment_failed'); // still shown — it drives the score
  });

  it('shows no second badge when the filtered signal IS the strongest', () => {
    const r = sourceBadges(lead(['payment_pending'], 'payment_pending'), 'payment_pending');
    expect(r.lead).toBe('payment_pending');
    expect(r.also).toBeNull();
    expect(r.extra).toBe(0);
  });

  it('falls back to the strongest signal when no filter is active', () => {
    const r = sourceBadges(lead(['payment_pending', 'payment_failed'], 'payment_failed'), '');
    expect(r.lead).toBe('payment_failed');
    expect(r.also).toBeNull();
  });

  it('counts only the signals it has not already named', () => {
    // Six signals, two named → +4, not the old +5.
    const r = sourceBadges(
      lead(
        ['payment_pending', 'payment_failed', 'cart_abandoned', 'consultation', 'dormant_user', 'order_cancelled'],
        'order_cancelled',
      ),
      'payment_pending',
    );
    expect(r.lead).toBe('payment_pending');
    expect(r.also).toBe('order_cancelled');
    expect(r.extra).toBe(4);
  });

  it('ignores a filter the person does not actually carry', () => {
    const r = sourceBadges(lead(['payment_failed'], 'payment_failed'), 'consultation');
    expect(r.lead).toBe('payment_failed');
    expect(r.also).toBeNull();
  });

  it('survives a lead with no primary source', () => {
    const r = sourceBadges({ sources: [{ type: 'payment_pending' }], primarySource: null }, '');
    expect(r.lead).toBeNull();
    expect(r.extra).toBe(1);
  });
});
