/**
 * Admin campaign editor — the page must render the campaign it actually has.
 *
 * It previously rendered the cart-value UI and the allowlist roster unconditionally,
 * which made it contradict itself on a public product-tier campaign: an "Invited 191"
 * count against an audience that never reads the allowlist, resolution copy describing
 * the opposite of the real rule, an "add a tier" button whose save the server rejects,
 * and a calculator reporting ₹0 for every row.
 *
 * The regression that matters most is the LAST describe block: a cart-value allowlist
 * campaign must be untouched by all of this.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminCampaignEditor from './page';

jest.mock('next/navigation', () => ({ useParams: () => ({ slug: 'c' }) }));
jest.mock('@/components/admin/campaigns/MemberRosterPanel', () => ({
  __esModule: true, default: () => <div data-testid="roster" />,
}));
jest.mock('@/components/admin/campaigns/ProductTierPanel', () => ({
  __esModule: true, default: () => <div data-testid="product-tier-panel" />,
}));
jest.mock('@/lib/api', () => ({
  __esModule: true, default: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
}));
import apiClient from '@/lib/api';

const BASE = {
  _id: 'c1', slug: 'c', name: 'Festive', status: 'off',
  requireVerifiedEmail: true, allowKarmaStacking: false, testerEmails: [],
  startsAt: null, endsAt: null, resolution: 'best',
  maxDiscountPerOrder: 50000, maxRedemptions: 200,
  redeemedCount: 0, discountGivenRupees: 0, couponCode: 'X', landingPath: '/festive',
};

const CART_TIERS = [{ id: 'a', label: 'A', minCartValue: 0, percent: 20, maxDiscount: 20000 }];
const PRODUCT_TIERS = [
  { code: 'bronkz', label: 'Bronkz', percent: 3 },
  { code: 'thanos', label: 'Thanos', percent: 8 },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

const REPORT = {
  members: { invited: 190, claimed: 1, redeemed: 0, total: 191 },
  redeemedCount: 0, maxRedemptions: 200, discountGivenRupees: 0,
  remainingExposureRupees: 10000000,
};

function renderPage(campaign: Record<string, unknown>) {
  (apiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/report') ? { success: true, report: REPORT } : { success: true, campaign },
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminCampaignEditor />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
describe('a PUBLIC, product-tier campaign', () => {
  const campaign = { ...BASE, audience: 'everyone', tiers: [], productTiers: PRODUCT_TIERS };

  it('does not report an invited count for an audience with no allowlist', async () => {
    renderPage(campaign);
    expect(await screen.findByText('Festive')).toBeInTheDocument();
    // 191 CampaignMember rows exist but are inert — evaluate() never reads them.
    expect(screen.queryByText('Invited')).not.toBeInTheDocument();
    expect(screen.queryByText('Signed in')).not.toBeInTheDocument();
  });

  it('still reports what the campaign has actually cost', async () => {
    renderPage(campaign);
    expect(await screen.findByText('Redeemed')).toBeInTheDocument();
    expect(screen.getByText('Given away')).toBeInTheDocument();
  });

  it('hides the allowlist roster without implying the members are gone', async () => {
    renderPage(campaign);
    await screen.findByText('Festive');
    expect(screen.queryByTestId('roster')).not.toBeInTheDocument();
  });

  it('does not offer to import an allowlist nothing would read', async () => {
    renderPage(campaign);
    await screen.findByText('Festive');
    // Targets the panel HEADING, not the audience dropdown's "Invited customers only"
    // option — that option must stay, or you could never switch back to an allowlist.
    expect(screen.queryByRole('heading', { name: /invited customers/i })).not.toBeInTheDocument();
  });

  it('does not describe best-for-customer resolution, which is the opposite rule', async () => {
    renderPage(campaign);
    await screen.findByText('Festive');
    expect(screen.queryByText(/whichever tier gives the most/i)).not.toBeInTheDocument();
    expect(screen.getByText(/lowest/i)).toBeInTheDocument();
  });

  it('shows the product ladder with its rates, and locks the codes', async () => {
    renderPage(campaign);
    expect(await screen.findByDisplayValue('Bronkz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Thanos')).toBeInTheDocument();
    // The code is the key assignments point at — renaming it strands them.
    expect(screen.getByDisplayValue('bronkz')).toHaveAttribute('readOnly');
  });

  it('offers the product assignment panel', async () => {
    renderPage(campaign);
    expect(await screen.findByTestId('product-tier-panel')).toBeInTheDocument();
  });

  it('keeps the shared limits reachable', async () => {
    // These used to live inside the cart-value card; hiding that card would have taken
    // the redemption cap with it, and an open campaign cannot go live without one.
    renderPage(campaign);
    expect(await screen.findByDisplayValue('200')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50000')).toBeInTheDocument();
    expect(screen.getByText(/required before an open campaign can go live/i)).toBeInTheDocument();
  });

  it('offers a product calculator, not the cart-value one', async () => {
    renderPage(campaign);
    // The cart calculator resolves `tiers`; against this campaign it reports ₹0 for
    // every row, which reads as "the offer pays nothing".
    expect(await screen.findByPlaceholderText(/search products/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^calculate$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('an ALLOWLIST, cart-value campaign — the regression case', () => {
  const campaign = { ...BASE, audience: 'list', tiers: CART_TIERS };

  it('still reports the invited funnel', async () => {
    renderPage(campaign);
    expect(await screen.findByText('Invited')).toBeInTheDocument();
    expect(screen.getByText('191')).toBeInTheDocument();
  });

  it('still shows the roster and the import panel', async () => {
    renderPage(campaign);
    expect(await screen.findByTestId('roster')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /invited customers/i })).toBeInTheDocument();
  });

  it('still shows the cart-value ladder and its resolution copy', async () => {
    renderPage(campaign);
    expect(await screen.findByText(/whichever tier gives the most/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('A')).toBeInTheDocument();
  });

  it('still shows the cart-value calculator', async () => {
    renderPage(campaign);
    expect(await screen.findByRole('button', { name: /^calculate$/i })).toBeInTheDocument();
  });

  it('does not show product-tier tooling', async () => {
    renderPage(campaign);
    await screen.findByText('Festive');
    expect(screen.queryByTestId('product-tier-panel')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search products/i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a PUBLIC, cart-value campaign', () => {
  it('keeps the cart ladder but drops the roster', async () => {
    // The two axes are independent: audience decides the roster, the ladder decides
    // the pricing UI. Neither should imply the other.
    renderPage({ ...BASE, audience: 'everyone', tiers: CART_TIERS });
    expect(await screen.findByText(/whichever tier gives the most/i)).toBeInTheDocument();
    expect(screen.queryByTestId('roster')).not.toBeInTheDocument();
    expect(screen.queryByText('Invited')).not.toBeInTheDocument();
  });
});
