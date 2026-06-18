
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Home from './page';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock useIsMounted to always return true for tests
jest.mock('@/lib/hooks/useIsMounted', () => ({
  __esModule: true,
  default: () => true,
}));

// Mock Child Components
jest.mock('@/components/layout/HeroBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="hero-banner">Hero Banner</div>,
}));

jest.mock('@/components/vehicles/VehicleSelector', () => ({
  __esModule: true,
  default: ({ onVehicleSelect }: { onVehicleSelect: (make: string, model: string) => void }) => (
    <div data-testid="vehicle-selector">
      <button onClick={() => onVehicleSelect('Toyota', 'Camry')}>Select Toyota Camry</button>
    </div>
  ),
}));

jest.mock('@/components/products/FeaturedProducts', () => ({
  __esModule: true,
  default: () => <div data-testid="featured-products">Featured Products</div>,
}));

jest.mock('@/components/products/ModernFastMovingSection', () => ({
  __esModule: true,
  default: () => <div data-testid="modern-fast-moving">Modern Fast Moving Section</div>,
}));

jest.mock('@/components/products/KeepShoppingWidget', () => ({
  __esModule: true,
  default: () => <div data-testid="keep-shopping">Keep Shopping Widget</div>,
}));

jest.mock('@/components/products/RecentlyViewedProducts', () => ({
  __esModule: true,
  default: () => <div data-testid="recently-viewed">Recently Viewed Products</div>,
}));

jest.mock('@/components/layout/SuperCarsBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="super-cars-banner">Super Cars Banner</div>,
}));

describe('Home Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders home page structure', async () => {
    render(<Home />);
    
    expect(screen.getByTestId('hero-banner')).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByTestId('vehicle-selector')).toBeInTheDocument();
    });
    
    expect(screen.getByText('Find Parts for Your Vehicle')).toBeInTheDocument();
    expect(screen.getByText('Trusted Brands')).toBeInTheDocument();
  });

  it('handles vehicle selection and navigation', async () => {
    render(<Home />);
    
    // Simulate vehicle selection from the mocked component
    const selectBtn = screen.getByText('Select Toyota Camry');
    fireEvent.click(selectBtn);
    
    // Check if the "View Parts" button appears
    await waitFor(() => {
      expect(screen.getByText('View Toyota Camry Parts')).toBeInTheDocument();
    });
    
    // Check link href (since it uses Next.js Link, we check the attribute)
    const viewPartsLink = screen.getByRole('link', { name: /View Toyota Camry Parts/i });
    expect(viewPartsLink).toHaveAttribute('href', '/model/toyota-camry');
  });

  it('renders featured vehicle categories', () => {
    render(<Home />);
    
    // Check for "See More" card
    expect(screen.getByText('See More')).toBeInTheDocument();
    expect(screen.getByText('View all vehicles')).toBeInTheDocument();
  });

  it('renders brand logos', () => {
    render(<Home />);
    
    // Check for some brand alt texts that are hardcoded in the component
    // Note: In the actual file, brands like Profender, Bushranger, Ironman are present
    // Use getAllByAltText because the carousel might duplicate items for infinite scroll effect
    expect(screen.getAllByAltText('Profender').length).toBeGreaterThan(0);
    expect(screen.getAllByAltText('Bushranger').length).toBeGreaterThan(0);
    expect(screen.getAllByAltText('Ironman').length).toBeGreaterThan(0);
  });
});
