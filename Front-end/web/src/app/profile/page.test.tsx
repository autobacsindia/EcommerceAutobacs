import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfilePage from './page';
import { useAuth } from '@/context/AuthContext';
import profileService from '@/lib/profileService';
import apiClient from '@/lib/api';
import orderService from '@/lib/services/orderService';

// Mock dependencies
jest.mock('@/context/AuthContext');
jest.mock('@/lib/profileService');
jest.mock('@/lib/api');
jest.mock('@/lib/services/orderService');
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/profile',
}));
jest.mock('next/link', () => {
  return ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  );
});
jest.mock('@/components/tracking/TimelineProgress', () => ({
  TimelineProgress: () => <div data-testid="timeline-progress">Timeline</div>,
}));

// NOTE: lucide-react is deliberately NOT mocked. The old hand-listed icon mock went
// stale every time the page imported a new icon (a missing entry renders as undefined
// and blanks the whole page), and the real icons render fine under jsdom.

/**
 * The page reads through TanStack Query, so it needs a client. Retries are off and each
 * test gets a fresh cache, so one test's profile can't leak into the next.
 */
const renderProfile = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfilePage />
    </QueryClientProvider>
  );
};

describe('ProfilePage', () => {
  const mockUser = {
    _id: 'u1',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'user',
  };

  const mockProfile = {
    _id: 'u1',
    name: 'John Doe',
    email: 'john@example.com',
    addresses: [],
  };

  const mockOrders = {
    orders: [
      {
        _id: 'o1',
        orderNumber: 'ORD-123',
        status: 'delivered',
        totalAmount: 100,
        createdAt: '2023-01-01T00:00:00Z',
        items: [{ product: { name: 'Test Product', images: ['img.jpg'] }, quantity: 1 }],
      },
    ],
    pagination: { page: 1, pages: 1 },
    count: 1,
  };

  const mockReviews = {
    reviews: [],
    pagination: { page: 1, pages: 1 },
    count: 0,
  };

  const mockReturnRequests = {
    requests: [],
    pagination: { page: 1, pages: 1 },
    count: 0,
  };


  const mockPaymentMethods = {
    paymentMethods: [],
    count: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks keeps implementations; reset so one test's router stub can't leak.
    mockPush.mockReset();
    mockReplace.mockReset();
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      logout: jest.fn(),
    });

    (profileService.getProfile as jest.Mock).mockResolvedValue(mockProfile);
    (profileService.getOrders as jest.Mock).mockResolvedValue(mockOrders);
    // RecentOrdersCard reads through orderService, not profileService.
    (orderService.getUserOrders as jest.Mock).mockResolvedValue(mockOrders);
    (profileService.getMyReviews as jest.Mock).mockResolvedValue(mockReviews);
    (profileService.getMyReturnRequests as jest.Mock).mockResolvedValue(mockReturnRequests);
    (profileService.getPaymentMethods as jest.Mock).mockResolvedValue(mockPaymentMethods);

    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url === '/auth/verification-status') {
        return Promise.resolve({ success: true, isVerified: true, email: 'john@example.com' });
      }
      if (url === '/contact/me') {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
  });

  it('renders profile page with user data', async () => {
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });
  });

  it('surfaces recent orders on the profile', async () => {
    renderProfile();

    // RecentOrdersCard renders the order number when present, falling back to the id.
    expect(await screen.findByText('#ORD-123')).toBeInTheDocument();
  });

  describe('signing out', () => {
    it('lands on the home page, not the login screen', async () => {
      // Logging out is a deliberate exit: the customer stays in the store, and the nav's
      // profile icon / "Sign In" row is their way back to /login when they want it.
      const logout = jest.fn().mockResolvedValue(undefined);
      (useAuth as jest.Mock).mockReturnValue({
        user: mockUser,
        isAuthenticated: true,
        isLoading: false,
        logout,
      });

      renderProfile();
      await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /logout/i }));

      await waitFor(() => expect(logout).toHaveBeenCalled());
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
      expect(mockReplace).not.toHaveBeenCalledWith(expect.stringContaining('/login'));
      expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/login'));
    });

    it('clears the session before navigating', async () => {
      // Order matters: navigating first would leave the home page rendering the signed-in
      // nav until logout() resolved.
      const calls: string[] = [];
      const logout = jest.fn(async () => { calls.push('logout'); });
      mockReplace.mockImplementation(() => { calls.push('replace'); });
      (useAuth as jest.Mock).mockReturnValue({
        user: mockUser,
        isAuthenticated: true,
        isLoading: false,
        logout,
      });

      renderProfile();
      await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /logout/i }));

      await waitFor(() => expect(calls).toEqual(['logout', 'replace']));
    });
  });

  it('bounces a signed-out visitor to login carrying /profile as the destination', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      logout: jest.fn(),
    });

    renderProfile();

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Fprofile')
    );
  });
});
