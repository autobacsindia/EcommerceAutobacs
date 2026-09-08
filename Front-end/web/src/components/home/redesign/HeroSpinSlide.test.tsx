import { render, screen } from '@testing-library/react';
import HeroSpinSlide, { eligibilityLine } from './HeroSpinSlide';
import type { SpinTeaser } from './homeData';

/**
 * The teaser slide's CLAIMS.
 *
 * The source poster hard-coded "Every order unlocks one spin. No minimum spend." Neither
 * is a fact about this business — the campaign owns both numbers and an operator can
 * change them from /admin/spin without touching any of this code. So the eligibility
 * sentence is derived, and these tests exist because a wrong derivation puts a promise
 * on the home page that the spin engine will refuse at checkout. That failure would look
 * perfectly fine in a browser.
 */

const teaser = (over: Partial<SpinTeaser> = {}): SpinTeaser => ({
  slug: 'diwali',
  name: 'Diwali Rewards',
  endsAt: new Date(Date.now() + 86400000).toISOString(),
  minOrderValuePaise: 0,
  maxSpinsPerUserPerCampaign: 1,
  terms: null,
  prizes: [
    { name: 'Dash Cam', shortLabel: 'Dash Cam', imageUrl: null, kind: 'goodie' },
    { name: 'Steel Mug', shortLabel: 'Steel Mug', imageUrl: null, kind: 'goodie' },
    { name: '₹500 Off', shortLabel: '₹500 Off', imageUrl: null, kind: 'coupon' },
  ],
  ...over,
});

describe('eligibilityLine — the sentence that must never over-promise', () => {
  it('states a real minimum spend in rupees, not paise', () => {
    // 250000 paise = ₹2,500. Getting this wrong by 100x is the classic paise bug, and
    // it would advertise ₹250,000 or ₹25 depending on the direction.
    expect(eligibilityLine(teaser({ minOrderValuePaise: 250000 })))
      .toBe('One spin per customer, on orders over ₹2,500.');
  });

  it('only claims "no minimum spend" when the campaign truly has none', () => {
    expect(eligibilityLine(teaser({ minOrderValuePaise: 0 })))
      .toContain('with no minimum spend');
    expect(eligibilityLine(teaser({ minOrderValuePaise: 1 })))
      .not.toContain('no minimum spend');
  });

  it('says "every eligible order" only when spins are genuinely uncapped', () => {
    expect(eligibilityLine(teaser({ maxSpinsPerUserPerCampaign: null })))
      .toContain('Every eligible order earns a spin');
    // The backend default is 1 per user per campaign — NOT one per order, which is what
    // the poster claimed.
    expect(eligibilityLine(teaser({ maxSpinsPerUserPerCampaign: 1 })))
      .toContain('One spin per customer');
    expect(eligibilityLine(teaser({ maxSpinsPerUserPerCampaign: 3 })))
      .toContain('Up to 3 spins per customer');
  });

  it('formats large minimums with Indian digit grouping', () => {
    expect(eligibilityLine(teaser({ minOrderValuePaise: 10000000 }))).toContain('₹1,00,000');
  });
});

describe('HeroSpinSlide', () => {
  it('names the live campaign and lists its real prizes', () => {
    render(<HeroSpinSlide teaser={teaser()} active={false} />);

    expect(screen.getByText(/Diwali Rewards/)).toBeInTheDocument();
    // The dial is aria-hidden, so this text IS the accessible prize list.
    expect(screen.getByText(/Prizes include Dash Cam, Steel Mug, ₹500 Off\./)).toBeInTheDocument();
  });

  it('never claims the visitor has won anything', () => {
    const { container } = render(<HeroSpinSlide teaser={teaser()} active={false} />);
    const text = container.textContent ?? '';

    // "Prizes include", never "you win" — the draw is weighted and stock-limited on
    // the server, and nothing on this page has run it.
    expect(text).toMatch(/Prizes include/);
    expect(text).not.toMatch(/you (have )?won/i);
    expect(text).not.toMatch(/you'?d win/i);
  });

  it('sends the CTA to the catalogue, because a spin is earned by a paid order', () => {
    render(<HeroSpinSlide teaser={teaser()} active={false} />);
    // A "go spin" link would dead-end: the wheel lives on the order-success page.
    expect(screen.getByRole('link', { name: /shop now/i })).toHaveAttribute('href', '/products');
  });
});
