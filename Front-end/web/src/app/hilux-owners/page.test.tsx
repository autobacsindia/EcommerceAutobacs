/**
 * /hilux-owners — where the thank-you card QR lands (via the /onam redirect).
 * Every branch must end in something the cardholder can act on, and the code must be
 * readable on screen whatever happens to storage.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import HiluxOwnersPage from './page';
import { useAuth } from '@/context/AuthContext';
import { readPendingCoupon } from '@/lib/pendingCoupon';
import { metadata } from './layout';

jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));

const mockAuth = (v: Partial<ReturnType<typeof useAuth>>) =>
  (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isLoading: false, user: null, ...v });

describe('/hilux-owners', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows the code and saves it for the cart', () => {
    mockAuth({});
    render(<HiluxOwnersPage />);
    expect(screen.getByTestId('hilux-code')).toHaveTextContent('HILUX5000');
    expect(readPendingCoupon()).toBe('HILUX5000');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('₹5,000');
  });

  it('signed out: sign-in and register both come back here', () => {
    mockAuth({});
    render(<HiluxOwnersPage />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?redirect=%2Fhilux-owners');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register?redirect=%2Fhilux-owners');
  });

  it('signed in: links to the Travo, Revo and Hilux parts', () => {
    mockAuth({ isAuthenticated: true, user: { name: 'Anu' } as never });
    render(<HiluxOwnersPage />);
    expect(screen.getByTestId('hilux-signed-in')).toHaveTextContent('Anu');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining([
      '/model/toyota-hilux-travo', '/model/toyota-hilux-revo',
    ]));
    // Generic Hilux parts are not covered, so the page must not send people there.
    expect(hrefs).not.toContain('/model/toyota-hilux');
  });

  it('holds a spinner while auth settles (no signed-out flash)', () => {
    mockAuth({ isLoading: true });
    render(<HiluxOwnersPage />);
    expect(screen.getByTestId('hilux-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('hilux-signed-out')).toBeNull();
  });

  it('is never indexed', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
  });
});
