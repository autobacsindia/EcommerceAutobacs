
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import Home from '../page'; // Adjust path if needed

// Mock useIsMounted to return true immediately
jest.mock('@/lib/hooks/useIsMounted', () => ({
  __esModule: true,
  default: () => true,
}));

// Mock dynamic components
jest.mock('@/components/layout/HeroBanner', () => {
  return function MockHeroBanner() {
    return <div data-testid="hero-banner">Hero Banner</div>;
  };
});

jest.mock('@/components/vehicles/VehicleSelector', () => {
  return function MockVehicleSelector({ onVehicleSelect }: { onVehicleSelect: (make: string, model: string) => void }) {
    return (
      <div data-testid="vehicle-selector">
        <button onClick={() => onVehicleSelect('Toyota', 'Corolla')}>Select Toyota Corolla</button>
      </div>
    );
  };
});

jest.mock('@/components/products/FastMovingProducts', () => {
  return function MockFastMovingProducts() {
    return <div data-testid="fast-moving-products">Fast Moving Products</div>;
  };
});

jest.mock('@/components/products/ModernFastMovingSection', () => {
  return function MockModernFastMovingSection() {
    return <div data-testid="modern-fast-moving-section">Modern Fast Moving Section</div>;
  };
});

jest.mock('@/components/products/KeepShoppingWidget', () => {
  return function MockKeepShoppingWidget() {
    return <div data-testid="keep-shopping-widget">Keep Shopping Widget</div>;
  };
});

jest.mock('@/components/products/RecentlyViewedProducts', () => {
  return function MockRecentlyViewedProducts() {
    return <div data-testid="recently-viewed-products">Recently Viewed Products</div>;
  };
});

jest.mock('@/components/layout/SuperCarsBanner', () => {
  return function MockSuperCarsBanner() {
    return <div data-testid="super-cars-banner">Super Cars Banner</div>;
  };
});

describe('Home Page Integration', () => {
  it('renders home page components correctly', async () => {
    render(<Home />);
    
    // Check for Hero Banner
    expect(screen.getByTestId('hero-banner')).toBeInTheDocument();
    
    // Check for Vehicle Selector Section
    expect(screen.getByText(/find parts for your vehicle/i)).toBeInTheDocument();
    
    await waitFor(() => {
        expect(screen.getByTestId('vehicle-selector')).toBeInTheDocument();
    });
    
    // Check for other sections
    // Note: Since they are dynamically imported, they might take a moment or be mocked directly
    // With jest.mock, they should appear immediately
    
    // Wait for dynamic imports if necessary (though mocks usually handle this)
    await waitFor(() => {
        expect(screen.getByTestId('modern-fast-moving-section')).toBeInTheDocument();
        // KeepShoppingWidget and RecentlyViewedProducts might be conditional or present
    });
    
    // Check for other sections
    expect(screen.getByText('Popular Categories')).toBeInTheDocument();
    expect(screen.getByTestId('modern-fast-moving-section')).toBeInTheDocument();
  });

  it('handles vehicle selection', async () => {
    render(<Home />);
    
    // Initially the link should not be present
    expect(screen.queryByText(/view toyota corolla parts/i)).not.toBeInTheDocument();
    
    const selectorButton = screen.getByText('Select Toyota Corolla');
    selectorButton.click();
    
    // After selection, the link should appear
    await waitFor(() => {
      expect(screen.getByText(/view toyota corolla parts/i)).toBeInTheDocument();
    });
    
    const link = screen.getByText(/view toyota corolla parts/i);
    expect(link).toHaveAttribute('href', '/model/toyota-corolla');
  });
});
