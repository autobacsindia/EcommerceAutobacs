import React from 'react';
import { render, screen } from '@testing-library/react';
import AffiliateDashboardPage from './page';
import AffiliatesPage from '../../affiliates/page';
import { useAuth } from '@/context/AuthContext';
import { useMyAffiliate, useMyCommissions } from '@/hooks/queries/useAffiliate';

jest.mock('@/context/AuthContext');
jest.mock('@/hooks/queries/useAffiliate');
jest.mock('@/lib/hooks/useRequireAuth', () => ({
  useRequireAuth: () => ({ releaseGuard: jest.fn() }),
}));
jest.mock('next/link', () => {
  const Link = ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
  Link.displayName = 'Link';
  return Link;
});

/**
 * Regression tests for the "verdict rendered before the answer arrived" class of bug.
 *
 * TanStack v5 reports `isLoading: false` for a DISABLED query, and these pages disable
 * theirs until AuthContext resolves the user in an effect. So an `isLoading`-only gate
 * is false on the first paint and the component renders a conclusion it does not have
 * yet — telling a real affiliate they are not one, or showing an approved affiliate the
 * apply form they have already completed.
 *
 * Both pages shipped exactly that. These tests pin the window shut.
 */

const PENDING_QUERY = { data: undefined, isPending: true, isError: false, isLoading: false };
const NO_COMMISSIONS = { data: undefined, isLoading: false };

const AFFILIATE = {
  _id: 'a1',
  code: 'RAHUL10',
  name: 'Rahul',
  status: 'active' as const,
  commissionPercent: 10,
  repeatCommissionPercent: 3,
  discountPercent: 10,
  approvedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  payoutDetails: { accountLast4: '4321', ifsc: null, upiId: null },
  termsAcceptance: { version: '2026-09-09', acceptedAt: null },
};

describe('affiliate pages never render a verdict before the answer arrives', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useMyCommissions as jest.Mock).mockReturnValue(NO_COMMISSIONS);
  });

  describe('/account/affiliate', () => {
    it('shows a spinner — not "not an affiliate" — while auth is still resolving', () => {
      // The exact first paint of a cold load from the approval-email link, which is
      // this page's primary entry point.
      (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, user: null, isLoading: true });
      (useMyAffiliate as jest.Mock).mockReturnValue(PENDING_QUERY);

      render(<AffiliateDashboardPage />);
      expect(screen.getByText(/loading your affiliate dashboard/i)).toBeInTheDocument();
      expect(screen.queryByText(/not an affiliate yet/i)).not.toBeInTheDocument();
    });

    it('still waits once auth resolves but the profile is in flight', () => {
      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true, user: { _id: 'u1' }, isLoading: false,
      });
      (useMyAffiliate as jest.Mock).mockReturnValue(PENDING_QUERY);

      render(<AffiliateDashboardPage />);
      expect(screen.queryByText(/not an affiliate yet/i)).not.toBeInTheDocument();
    });

    it('treats a failed fetch as an error, NOT as "you are not an affiliate"', () => {
      // Falling through to that branch tells someone their membership vanished because
      // a request timed out.
      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true, user: { _id: 'u1' }, isLoading: false,
      });
      (useMyAffiliate as jest.Mock).mockReturnValue({
        data: undefined, isPending: false, isError: true, isLoading: false,
      });

      render(<AffiliateDashboardPage />);
      expect(screen.getByText(/couldn.t load your dashboard/i)).toBeInTheDocument();
      expect(screen.queryByText(/not an affiliate yet/i)).not.toBeInTheDocument();
    });

    it('renders the invitation once the server actually answers "null"', () => {
      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true, user: { _id: 'u1' }, isLoading: false,
      });
      (useMyAffiliate as jest.Mock).mockReturnValue({
        data: { success: true, affiliate: null }, isPending: false, isError: false, isLoading: false,
      });

      render(<AffiliateDashboardPage />);
      expect(screen.getByText(/not an affiliate yet/i)).toBeInTheDocument();
    });
  });

  describe('/affiliates', () => {
    it('does NOT flash the PAN/bank form at a signed-in affiliate', () => {
      // The form asks for PAN, account number and IFSC. Painting it and swapping it away
      // discards anything already typed — and this branch exists to prevent exactly that.
      (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true, isLoading: false });
      (useMyAffiliate as jest.Mock).mockReturnValue(PENDING_QUERY);

      render(<AffiliatesPage />);
      expect(screen.queryByLabelText(/PAN/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /apply to join/i })).not.toBeInTheDocument();
    });

    it('shows the form to an ANONYMOUS visitor immediately', () => {
      /*
        The counterpart risk. `isPending` stays true forever on a disabled query, so a
        gate that ignored `isAuthenticated` would hide the application form from every
        logged-out visitor — i.e. from almost everyone this page is written for.
      */
      (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isLoading: false });
      (useMyAffiliate as jest.Mock).mockReturnValue(PENDING_QUERY);

      render(<AffiliatesPage />);
      expect(screen.getByRole('button', { name: /apply to join/i })).toBeInTheDocument();
    });

    it('sends an approved affiliate to the dashboard instead of the form', () => {
      (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true, isLoading: false });
      (useMyAffiliate as jest.Mock).mockReturnValue({
        data: { success: true, affiliate: AFFILIATE }, isPending: false, isError: false, isLoading: false,
      });

      render(<AffiliatesPage />);
      expect(screen.getByRole('link', { name: /open your dashboard/i }))
        .toHaveAttribute('href', '/account/affiliate');
      expect(screen.queryByRole('button', { name: /apply to join/i })).not.toBeInTheDocument();
    });
  });
});
