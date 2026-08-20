import React from 'react';
import { render, screen } from '@testing-library/react';
import OnamOfferPage from './page';
import { useAuth } from '@/context/AuthContext';

jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));

jest.mock('lucide-react', () => ({
  CheckCircle2: () => <span data-testid="check-icon">ok</span>,
  Gift: () => <span data-testid="gift-icon">gift</span>,
  Loader2: () => <span data-testid="loader-icon">loading</span>,
  ArrowRight: () => <span data-testid="arrow-icon">-&gt;</span>,
}));

const mockAuth = (state: Partial<ReturnType<typeof useAuth>>) =>
  (useAuth as jest.Mock).mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    ...state,
  });

describe('OnamOfferPage', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('while the auth check is still resolving', () => {
    // The signed-out branch must not flash at a customer who is already signed in —
    // they are holding the phone at the counter with staff watching.
    it('shows neither the sign-in prompt nor the activated panel', () => {
      mockAuth({ isLoading: true });
      render(<OnamOfferPage />);

      expect(screen.getByTestId('onam-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('onam-signin')).not.toBeInTheDocument();
      expect(screen.queryByTestId('onam-activated')).not.toBeInTheDocument();
    });
  });

  describe('when signed out', () => {
    beforeEach(() => mockAuth({ isAuthenticated: false }));

    it('offers registration as prominently as sign-in', () => {
      render(<OnamOfferPage />);
      expect(screen.getByTestId('onam-signin')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /activate my coupon/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /new here/i })).toBeInTheDocument();
    });

    // Both params must survive the hop, or the customer lands on a generic auth screen
    // with no offer context and no way back to this page.
    it('carries the offer and the return path into both auth screens', () => {
      render(<OnamOfferPage />);

      expect(screen.getByRole('link', { name: /activate my coupon/i }))
        .toHaveAttribute('href', '/login?offer=onam&redirect=%2Fonam');
      expect(screen.getByRole('link', { name: /new here/i }))
        .toHaveAttribute('href', '/register?offer=onam&redirect=%2Fonam');
    });

    it('does not claim the coupon is active', () => {
      render(<OnamOfferPage />);
      expect(screen.queryByText(/is activated/i)).not.toBeInTheDocument();
    });
  });

  describe('when signed in', () => {
    it('confirms the coupon is activated', () => {
      mockAuth({ isAuthenticated: true, user: { name: 'Anand' } });
      render(<OnamOfferPage />);

      expect(screen.getByTestId('onam-activated')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /your coupon is activated/i })).toBeInTheDocument();
      expect(screen.getByText(/all set, Anand/i)).toBeInTheDocument();
      expect(screen.queryByTestId('onam-signin')).not.toBeInTheDocument();
    });

    // A social sign-in can leave the name blank; the greeting still has to read.
    it('reads correctly when the account has no name', () => {
      mockAuth({ isAuthenticated: true, user: { name: '' } });
      render(<OnamOfferPage />);

      expect(screen.getByText(/^You're all set\.$/)).toBeInTheDocument();
      expect(screen.queryByText(/all set, /i)).not.toBeInTheDocument();
    });
  });
});
