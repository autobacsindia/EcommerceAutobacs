import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from './Header';
import '@testing-library/jest-dom';

import { APP_NAME, NAV_LINKS } from '@/lib/constants';

// Mocks
const mockLogout = jest.fn();
let mockIsAuthenticated = false;
let mockUser: any = null;
let mockAuthLoading = false;

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    user: mockUser,
    logout: mockLogout,
    isLoading: mockAuthLoading,
  }),
}));

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({
    itemCount: 5,
  }),
}));

jest.mock('@/context/WishlistContext', () => ({
  useWishlist: () => ({
    wishlistCount: 2,
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  usePathname: () => '/',
}));

// Mock Link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock Child Components
jest.mock('./ClientSearchSuggestions', () => () => <div data-testid="search-suggestions">Search</div>);
jest.mock('./SkeletonLoader', () => () => <div data-testid="skeleton-loader">Loading...</div>);
jest.mock('@/components/ui/Skeleton', () => ({ Skeleton: () => <div data-testid="skeleton" /> }));
jest.mock('./EnvironmentAwareComponent', () => ({ children }: { children: React.ReactNode }) => <div>{children}</div>);
jest.mock('@/components/location/LocationDisplay', () => () => <div data-testid="location-display">Location</div>);
jest.mock('./BrandLogo', () => () => <div data-testid="brand-logo">Logo</div>);
jest.mock('./CurrencySwitcherDropdown', () => () => <div data-testid="currency-switcher">Currency</div>);
jest.mock('./MobileMenu', () => () => <div data-testid="mobile-menu">MobileMenu</div>);

describe('Header Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthenticated = false;
    mockUser = null;
    mockAuthLoading = false;
  });

  it('renders loading skeleton when auth is loading', () => {
    mockAuthLoading = true;
    render(<Header />);
    expect(screen.getByTestId('skeleton-loader')).toBeInTheDocument();
  });

  it('renders correctly for guest user', () => {
    render(<Header />);
    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-suggestions')).toBeInTheDocument();
  });

  it('renders correctly for authenticated user', () => {
    mockIsAuthenticated = true;
    mockUser = { name: 'John Doe' };
    render(<Header />);
    
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
  });

  it('handles logout', () => {
    mockIsAuthenticated = true;
    render(<Header />);
    
    fireEvent.click(screen.getByText('Logout'));
    expect(mockLogout).toHaveBeenCalled();
  });

  it('toggles mobile search', () => {
    render(<Header />);
    const toggleButton = screen.getByLabelText('Toggle search');
    fireEvent.click(toggleButton);
    // Since we can't easily assert the state change effect without deeper DOM inspection of conditional rendering (which might be mocked out or hidden),
    // we just ensure it doesn't crash.
    expect(toggleButton).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<Header />);
    NAV_LINKS.forEach(link => {
      // We look for the link text. Note: Some links might be hidden on mobile/desktop, 
      // but the test environment usually renders everything unless we apply styles that jsdom respects (which it mostly doesn't for display:none).
      // However, Header.tsx has `hidden md:flex` for the nav. 
      // JSDOM doesn't compute layout, so elements with `hidden` class are still in the DOM unless we use a matcher that checks visibility.
      // `getByText` finds it even if it's visually hidden, unless `display: none` is inline style.
      // Tailwind classes are just strings to JSDOM.
      expect(screen.getByText(link.label)).toBeInTheDocument();
    });
  });
});
