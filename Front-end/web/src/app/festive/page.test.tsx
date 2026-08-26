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
import { useCampaign, useActivateCampaign } from '@/hooks/queries/useCampaign';
import { trackCampaignOfferViewed } from '@/lib/analytics';

jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/queries/useCampaign', () => ({
  ...jest.requireActual('@/hooks/queries/useCampaign'),
  useCampaign: jest.fn(),
  useActivateCampaign: jest.fn(),
}));
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    // The REAL formatter's behaviour, not an approximation — see formatPriceMock.
    formatPrice: (n: number, o?: { exact?: boolean }) =>
      require('@/test-utils/formatPriceMock').formatPriceMock(n, o),
  }),
}));
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
  // The default campaign is UNGATED, so the existing cases keep exercising the page
  // exactly as before. The activation cases opt in explicitly.
  requiresActivation: false,
  activated: false,
  tier: null,
  tiers: [],
  maxDiscountPerOrder: null,
  productLadder: LADDER,
};

const mockAuth = (state: Record<string, unknown>) =>
  (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isLoading: false, user: null, ...state });

const mockCampaign = (state: Record<string, unknown>) =>
  (useCampaign as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, ...state });

/** The activation mutation, with a handle on `mutate` so tests can assert it fired. */
const mockActivate = (state: Record<string, unknown> = {}) => {
  const mutate = jest.fn();
  (useActivateCampaign as jest.Mock).mockReturnValue({
    mutate, isPending: false, isError: false, ...state,
  });
  return mutate;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Every case renders the page, and the page always calls this hook.
  mockActivate();
});

describe('the offer headline', () => {
  it('quantifies the reward in rupees, not as a rate', () => {
    /* The visitor has scanned a printed card and has no product in front of them — a
       percentage is the least actionable figure this page could print. The number is
       maxDiscountPerOrder, the ceiling pricingService enforces. */
    mockAuth({});
    mockCampaign({ data: { ...CAMPAIGN, maxDiscountPerOrder: 187000 } });
    render(<FestivePage />);
    expect(screen.getByText(/up to ₹1,87,000 off/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('needs no ladder-specific branch — a cart-value campaign reads the same', () => {
    /* Both shapes used to resolve to a top PERCENTAGE here, each by its own path. The
       ceiling is one field on the campaign, so neither shape can leave the page blank
       and there is no second code path to keep in step. */
    mockAuth({});
    mockCampaign({
      data: {
        ...CAMPAIGN,
        maxDiscountPerOrder: 187000,
        productLadder: null,
        tiers: [
          { id: 'a', label: 'A', minCartValue: 0, percent: 10, maxDiscount: null },
          { id: 'b', label: 'B', minCartValue: 5000, percent: 20, maxDiscount: null },
        ],
      },
    });
    render(<FestivePage />);
    expect(screen.getByText(/up to ₹1,87,000 off/i)).toBeInTheDocument();
  });

  it('still promises the reward when the campaign has no ceiling', () => {
    /* An uncapped campaign has no honest rupee maximum. Saying the reward is waiting
       without quantifying it beats inventing a figure or reverting to a rate. */
    mockAuth({});
    mockCampaign({ data: { ...CAMPAIGN, maxDiscountPerOrder: null } });
    render(<FestivePage />);
    expect(screen.getByText(/your reward is waiting/i)).toBeInTheDocument();
    expect(screen.queryByText(/up to/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('points at the product pages instead of publishing the rate table', () => {
    /* The 8/4/2 breakdown lived here so a smaller-than-expected saving read as the rule.
       Every card now names the saving on that product in rupees, and the bag itemises it
       per line, so the rates would only be three numbers to apply by hand. */
    mockAuth({});
    mockCampaign({ data: CAMPAIGN });
    render(<FestivePage />);
    // Said in the body, and (with no ceiling configured) in the hero too — both point
    // at the product pages rather than publishing three rates to apply by hand.
    expect(screen.getAllByText(/shown in rupees on every product/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/everything else/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
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

describe('activation — the offer reaching only people who scanned the card', () => {
  /*
    This page is the ONLY way to activate, and that is what makes a public offer
    unadvertised: the route has no link anywhere on the site, is noindex, and is absent
    from the sitemap, so being here means arriving from the printed card.
  */

  it('activates a signed-in visitor who has not yet claimed', () => {
    mockAuth({ isAuthenticated: true });
    mockCampaign({
      data: { ...CAMPAIGN, eligible: false, reasonCode: 'not_activated', requiresActivation: true },
    });
    const mutate = mockActivate();

    render(<FestivePage />);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-activate someone who already has', () => {
    mockAuth({ isAuthenticated: true });
    mockCampaign({ data: { ...CAMPAIGN, requiresActivation: true, activated: true } });
    const mutate = mockActivate();

    render(<FestivePage />);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('never activates an ungated campaign', () => {
    // Otherwise every ordinary public sale quietly accumulates a roster of everyone who
    // opened its landing page — rows the campaign never reads.
    mockAuth({ isAuthenticated: true });
    mockCampaign({ data: { ...CAMPAIGN, requiresActivation: false } });
    const mutate = mockActivate();

    render(<FestivePage />);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('never activates a visitor who is not signed in', () => {
    // Nothing to record it against, and the panel below already asks them to sign in.
    mockAuth({ isAuthenticated: false });
    mockCampaign({
      data: { ...CAMPAIGN, eligible: false, reasonCode: 'login', requiresActivation: true },
    });
    const mutate = mockActivate();

    render(<FestivePage />);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('activates an UNVERIFIED customer too', () => {
    /*
      The funnel case, and the one an implementation keyed on `reasonCode` gets wrong:
      verification refuses BEFORE activation is considered, so this customer never
      reports 'not_activated'. They scan, register, and leave for their inbox — if
      nothing were recorded now, confirming their email would leave them eligible for
      nothing and the only way back is a page with no link on the site.
    */
    mockAuth({ isAuthenticated: true });
    mockCampaign({
      data: {
        ...CAMPAIGN, eligible: false, reasonCode: 'unverified',
        requiresActivation: true, activated: false,
      },
    });
    const mutate = mockActivate();

    render(<FestivePage />);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('shows the settling skeleton rather than flashing a refusal mid-activation', () => {
    // A cardholder who has just signed in must not read "this offer has not been
    // activated on your account" for half a second. That is the version they screenshot.
    mockAuth({ isAuthenticated: true });
    mockCampaign({
      data: { ...CAMPAIGN, eligible: false, reasonCode: 'not_activated', requiresActivation: true },
    });
    mockActivate();

    render(<FestivePage />);
    expect(screen.queryByText(/almost there/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you're in/i)).not.toBeInTheDocument();
  });

  it('stops waiting once the write has landed, even if the server still says not activated', () => {
    /*
      Regression: the skeleton used to latch for ever here.

      `needsActivation` is derived from the server's `activated`, and evaluate() cannot
      report that on a lifecycle refusal — it returns before the member row is read. So a
      campaign that ENDS while a tab is open reports `activated: false` about a customer
      who genuinely did activate. With the wait keyed only on `needsActivation`, the page
      sat on a pulsing skeleton indefinitely instead of saying the offer had closed.

      Once we have asked and been answered, the answer is what gets rendered.
    */
    mockAuth({ isAuthenticated: true });
    mockCampaign({
      data: {
        ...CAMPAIGN, eligible: false, reasonCode: 'ended',
        requiresActivation: true, activated: false,
      },
    });
    mockActivate({ isSuccess: true });

    render(<FestivePage />);
    // The conclusive panel, not the settling skeleton. Before the fix this assertion
    // failed because nothing but the pulsing placeholder was ever rendered.
    expect(screen.getByText(/isn't available just yet/i)).toBeInTheDocument();
  });

  it('DOES keep waiting while the write is still in flight', () => {
    // The other half of the same rule: the fix must not have simply removed the wait,
    // or a cardholder who has just signed in reads "not activated" for half a second.
    mockAuth({ isAuthenticated: true });
    mockCampaign({
      data: {
        ...CAMPAIGN, eligible: false, reasonCode: 'not_activated',
        requiresActivation: true, activated: false,
      },
    });
    mockActivate({ isPending: true });

    render(<FestivePage />);
    expect(screen.queryByText(/isn't available just yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/almost there/i)).not.toBeInTheDocument();
  });

  it('offers a retry when the activation write failed', () => {
    // The only refusal on this page the customer did nothing to cause. Without a button
    // they are holding a card that appears worthless.
    mockAuth({ isAuthenticated: true });
    mockCampaign({
      data: { ...CAMPAIGN, eligible: false, reasonCode: 'not_activated', requiresActivation: true },
    });
    mockActivate({ isError: true });

    render(<FestivePage />);
    expect(screen.getByText(/almost there/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activate my reward/i })).toBeInTheDocument();
  });
});
