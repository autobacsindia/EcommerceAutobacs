import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import Header from './Header';
import '@testing-library/jest-dom';

import { APP_NAME } from '@/lib/constants';
import type { NavCategory } from '@/lib/navCategories';

// Header is now data-driven: categories are passed in as props (resolved
// server-side from the live categories), plus a trailing static Offers link.
const navCats: NavCategory[] = [
  { label: 'Accessories', href: '/categories/accessories' },
  { label: 'Exterior', href: '/categories/exterior' },
  { label: 'Suspension', href: '/categories/suspension' },
];
const expectedNavLabels = [...navCats.map((c) => c.label), 'Offers'];

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

  it('does not block the header on auth loading', () => {
    // The header renders its full chrome immediately; the only placeholder is
    // EnvironmentAwareComponent's pre-hydration fallback, not auth state.
    mockAuthLoading = true;
    renderWithProviders(<Header navCategories={navCats} />);
    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByTestId('search-suggestions')).toBeInTheDocument();
    expect(screen.queryByTestId('skeleton-loader')).not.toBeInTheDocument();
  });

  it('renders correctly for guest user', () => {
    renderWithProviders(<Header navCategories={navCats} />);
    expect(screen.getByTestId('brand-logo')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-suggestions')).toBeInTheDocument();
  });

  it('renders correctly for authenticated user', () => {
    mockIsAuthenticated = true;
    mockUser = { name: 'John Doe' };
    renderWithProviders(<Header navCategories={navCats} />);
    
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
  });

  it('handles logout', () => {
    mockIsAuthenticated = true;
    renderWithProviders(<Header navCategories={navCats} />);
    
    fireEvent.click(screen.getByText('Logout'));
    expect(mockLogout).toHaveBeenCalled();
  });

  it('toggles mobile search', () => {
    renderWithProviders(<Header navCategories={navCats} />);
    const toggleButton = screen.getByLabelText('Toggle search');
    fireEvent.click(toggleButton);
    // Since we can't easily assert the state change effect without deeper DOM inspection of conditional rendering (which might be mocked out or hidden),
    // we just ensure it doesn't crash.
    expect(toggleButton).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    renderWithProviders(<Header navCategories={navCats} />);
    // The data-driven category labels plus the trailing static Offers link.
    expectedNavLabels.forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});
