/**
 * /festive — the public QR landing page.
 *
 * The cases that matter are the dead ends. A visitor is holding a printed card that
 * cannot be reissued, so every branch has to end in something they can act on: sign in,
 * confirm your email, or browse instead. A blank panel or a wrong instruction is a lost
 * customer with a piece of card and no recourse.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import FestivePage from './page';
import { useAuth } from '@/context/AuthContext';
import { useCampaign } from '@/hooks/queries/useCampaign';
import { trackCampaignOfferViewed } from '@/lib/analytics';

jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/queries/useCampaign', () => ({ useCampaign: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ trackCampaignOfferViewed: jest.fn() }));

jest.mock('lucide-react', () => ({
  Gift: () => <span>gift</span>,
  CheckCircle2: () => <span>ok</span>,
  ArrowRight: () => <span>-&gt;</span>,
  Clock: () => <span>clock</span>,
  ShieldCheck: () => <span>shield</span>,
  MailWarning: () => <span>mail</span>,
}));

const LADDER = { maxPercent: 8, defaultPercent: 4, onSaleMaxPercent: 2 };

const CAMPAIGN = {
  slug: 'festive-2026',
  name: 'Festive',
  endsAt: null,
  couponCode: 'FESTIVE2026',
  eligible: true,
  reason: null,
  reasonCode: null,
  tier: null,
  tiers: [],
  maxDiscountPerOrder: null,
  productLadder: LADDER,
};

const mockAuth = (state: Record<string, unknown>) =>
  (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isLoading: false, user: null, ...state });

const mockCampaign = (state: Record<string, unknown>) =>
  (useCampaign as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, ...state });

beforeEach(() => jest.clearAllMocks());

describe('the offer headline', () => {
  it('advertises the ladder\'s best rate, read from the campaign', () => {
    mockAuth({});
    mockCampaign({ data: CAMPAIGN });
    render(<FestivePage />);
    // Twice by design: once in the hero, once in the breakdown below it. Neither is
    // hardcoded — both come from productLadder.maxPercent.
    expect(screen.getAllByText(/up to 8% off/i)).toHaveLength(2);
  });

  it('states the default and on-sale rates up front, not at checkout', () => {
    // A buyer expecting 8% on something that earns 4% — or 2% because it is already
    // discounted — reads the difference as the site short-changing them.
    mockAuth({});
    mockCampaign({ data: CAMPAIGN });
    render(<FestivePage />);

    expect(screen.getByText(/everything else/i)).toBeInTheDocument();
    expect(screen.getByText('4% off')).toBeInTheDocument();
    expect(screen.getByText(/items already on offer/i)).toBeInTheDocument();
    expect(screen.getByText('2% off')).toBeInTheDocument();
  });

  it('falls back to a cart-value ladder when the campaign uses one', () => {
    mockAuth({});
    mockCampaign({
      data: {
        ...CAMPAIGN,
        productLadder: null,
        tiers: [
          { id: 'a', label: 'A', minCartValue: 0, percent: 10, maxDiscount: null },
          { id: 'b', label: 'B', minCartValue: 5000, percent: 20, maxDiscount: null },
        ],
      },
    });
    render(<FestivePage />);
    // Neither kind of campaign should leave this page blank.
    expect(screen.getByText(/up to 20% off/i)).toBeInTheDocument();
  });
});

describe('a signed-out visitor', () => {
  beforeEach(() => {
    mockAuth({ isAuthenticated: false });
    mockCampaign({ data: { ...CAMPAIGN, eligible: false, reasonCode: 'login' } });
  });

  it('is offered both sign-in and registration', () => {
    // The card is public now, so a scanner may well have no account at all. Offering
    // only "sign in" would strand them.
    render(<FestivePage />);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login?redirect=%2Ffestive');
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/register?redirect=%2Ffestive');
  });

  it('does not claim the reward is already active', () => {
    render(<FestivePage />);
    expect(screen.queryByText(/you're in/i)).not.toBeInTheDocument();
  });
});

describe('an eligible customer', () => {
  it('is told the discount applies with no code to enter', () => {
    mockAuth({ isAuthenticated: true });
    mockCampaign({ data: CAMPAIGN });
    render(<FestivePage />);

    expect(screen.getByText(/you're in/i)).toBeInTheDocument();
    expect(screen.getByText(/no code to enter/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start shopping/i })).toHaveAttribute('href', '/products');
  });
});

describe('a signed-in customer who cannot claim', () => {
  const blocked = (reasonCode: string) => {
    mockAuth({ isAuthenticated: true });
    mockCampaign({ data: { ...CAMPAIGN, eligible: false, reasonCode } });
    render(<FestivePage />);
  };

  it('sends an unverified customer to confirm their email, NOT to log in again', () => {
    // They are already signed in; a login link here would loop them forever.
    blocked('unverified');
    expect(screen.getByText(/confirm your email/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /resend the link/i })).toHaveAttribute('href', '/verify-email');
    expect(screen.queryByRole('link', { name: /^sign in$/i })).not.toBeInTheDocument();
  });

  it('says so plainly when every reward has gone', () => {
    blocked('exhausted');
    expect(screen.getByText(/fully claimed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse the catalogue/i })).toBeInTheDocument();
  });

  it('tells a repeat claimer they have already used it', () => {
    blocked('already_used');
    expect(screen.getByText(/already used this one/i)).toBeInTheDocument();
  });

  it('never guesses at an unrecognised reason', () => {
    blocked('some_future_reason');
    expect(screen.getByText(/isn't available just yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse the catalogue/i })).toBeInTheDocument();
  });
});

describe('when there is no campaign at all', () => {
  it('says the offer has ended rather than showing an empty page', () => {
    // The endpoint 404s when the campaign is off, unconfigured, or past its end date —
    // the steady state for most of the year.
    mockAuth({ isAuthenticated: false });
    mockCampaign({ data: undefined });
    render(<FestivePage />);

    expect(screen.getByText(/this offer has ended/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse the catalogue/i })).toBeInTheDocument();
  });

  it('shows neither claim nor ended message while still loading', () => {
    mockAuth({ isAuthenticated: false, isLoading: true });
    mockCampaign({ isLoading: true });
    render(<FestivePage />);

    // "This offer has ended" flashing at someone holding a valid card is the worst
    // outcome here, so loading must win over both branches.
    expect(screen.queryByText(/this offer has ended/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you're in/i)).not.toBeInTheDocument();
  });
});

/**
 * The scan signal.
 *
 * This is the only record that a printed card was used at all. A `$pageview` also fires,
 * but it is keyed on the PATH — and this route is permanent while the campaign behind it
 * is not, so the slug is what keeps one campaign's scans from being counted as the next
 * one's. Every case below is about that event being emitted exactly once, with an honest
 * answer rather than a loading state.
 */
describe('the scan signal', () => {
  const tracked = () => (trackCampaignOfferViewed as jest.Mock).mock.calls;

  it('reports the scan against the campaign slug, not the path', () => {
    mockAuth({});
    mockCampaign({ data: CAMPAIGN });
    render(<FestivePage />);
    expect(tracked()).toHaveLength(1);
    expect(tracked()[0][0]).toEqual({ slug: 'festive-2026', offerLive: true, eligible: true });
  });

  it('stays silent until the eligibility lookup settles, so it never reports a loading state as a refusal', () => {
    mockAuth({});
    mockCampaign({ data: undefined, isLoading: true });
    const { rerender } = render(<FestivePage />);
    expect(tracked()).toHaveLength(0);

    mockCampaign({ data: CAMPAIGN, isLoading: false });
    rerender(<FestivePage />);
    expect(tracked()).toHaveLength(1);
    expect(tracked()[0][0].eligible).toBe(true);
  });

  it('still records a scan of a card whose offer has ended — the case worth knowing about', () => {
    mockAuth({});
    // The campaign 404s once it is switched off, so the response cannot name itself.
    mockCampaign({ data: undefined, isLoading: false });
    render(<FestivePage />);
    expect(tracked()).toHaveLength(1);
    expect(tracked()[0][0]).toEqual({ slug: 'festive-2026', offerLive: false, eligible: null });
  });

  it('carries the visitor\'s own eligibility, so scans can be split from usable scans', () => {
    mockAuth({});
    mockCampaign({ data: { ...CAMPAIGN, eligible: false, reasonCode: 'login' } });
    render(<FestivePage />);
    expect(tracked()[0][0].eligible).toBe(false);
  });

  it('fires once per landing, not once per render', () => {
    mockAuth({});
    mockCampaign({ data: CAMPAIGN });
    const { rerender } = render(<FestivePage />);
    rerender(<FestivePage />);
    rerender(<FestivePage />);
    expect(tracked()).toHaveLength(1);
  });
});
