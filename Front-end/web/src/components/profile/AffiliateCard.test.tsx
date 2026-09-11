import React from 'react';
import { render, screen } from '@testing-library/react';
import AffiliateCard from './AffiliateCard';
import { useMyAffiliate, type MyAffiliate } from '@/hooks/queries/useAffiliate';

jest.mock('@/hooks/queries/useAffiliate');
jest.mock('next/link', () => {
  const Link = ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
  Link.displayName = 'Link';
  return Link;
});

/**
 * This card is the ONLY in-app route to /account/affiliate — the dashboard shipped with
 * nothing linking to it, so the single door was one line in the approval email. These
 * tests are about that link existing (or deliberately not) in each state, not styling.
 */

const AFFILIATE: MyAffiliate = {
  _id: 'a1',
  code: 'RAHUL10',
  name: 'Rahul',
  status: 'active',
  commissionPercent: 10,
  repeatCommissionPercent: 3,
  discountPercent: 10,
  approvedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  payoutDetails: { accountLast4: '4321', ifsc: 'HDFC0001234', upiId: null },
  termsAcceptance: { version: '2026-09-09', acceptedAt: '2026-08-01T00:00:00.000Z' },
};

const mockAffiliate = (affiliate: MyAffiliate | null | undefined) =>
  (useMyAffiliate as jest.Mock).mockReturnValue({
    data: affiliate === undefined ? undefined : { success: true, affiliate },
  });

const dashboardLink = () => screen.queryByRole('link', { name: /affiliate dashboard|open/i });

describe('AffiliateCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing until the first answer arrives', () => {
    // A placeholder that resolves into "become an affiliate" reads as a broken promise
    // to someone who already is one.
    mockAffiliate(undefined);
    const { container } = render(<AffiliateCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('invites an ordinary customer to the programme, not to the dashboard', () => {
    mockAffiliate(null);
    render(<AffiliateCard />);
    expect(screen.getByRole('link', { name: /learn more/i })).toHaveAttribute('href', '/affiliates');
    expect(screen.queryByRole('link', { name: /open/i })).not.toBeInTheDocument();
  });

  it('links an active affiliate to their dashboard and shows their code', () => {
    mockAffiliate(AFFILIATE);
    render(<AffiliateCard />);
    expect(dashboardLink()).toHaveAttribute('href', '/account/affiliate');
    expect(screen.getByText('RAHUL10')).toBeInTheDocument();
  });

  it('still links a SUSPENDED affiliate — their past earnings are on that page', () => {
    // Withholding the link here would hide money they have already earned. Suspension
    // stops new attribution; it does not void the ledger.
    mockAffiliate({ ...AFFILIATE, status: 'suspended' });
    render(<AffiliateCard />);
    expect(dashboardLink()).toHaveAttribute('href', '/account/affiliate');
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it('tells a pending applicant to wait, with no link to click', () => {
    // The dashboard would only repeat this sentence behind an extra navigation.
    mockAffiliate({ ...AFFILIATE, status: 'pending', code: null });
    render(<AffiliateCard />);
    expect(screen.getByText(/under review/i)).toBeInTheDocument();
    expect(dashboardLink()).not.toBeInTheDocument();
  });

  it('does not offer a rejected applicant the form again', () => {
    mockAffiliate({ ...AFFILIATE, status: 'rejected', code: null });
    render(<AffiliateCard />);
    expect(screen.getByText(/not accepted/i)).toBeInTheDocument();
    expect(dashboardLink()).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /learn more/i })).not.toBeInTheDocument();
  });
});
