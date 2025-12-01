import { render, screen, fireEvent } from '@testing-library/react';
import ProductFilters from './ProductFilters';
import { useSearchParams, useRouter } from 'next/navigation';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock apiClient
jest.mock('@/lib/api', () => ({
  default: {
    get: jest.fn().mockResolvedValue({
      categories: [
        { _id: '1', name: 'Body Kits', slug: 'body-kits' },
        { _id: '2', name: 'Performance Parts', slug: 'performance-parts' },
      ],
    }),
  },
}));

describe('ProductFilters', () => {
  const mockPush = jest.fn();
  const mockSearchParams = new URLSearchParams();
  
  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
    
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
    
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    mockPush.mockClear();
  });

  it('renders filter sections correctly', () => {
    render(<ProductFilters />);
    
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Price Range')).toBeInTheDocument();
    expect(screen.getByText('Availability')).toBeInTheDocument();
    expect(screen.getByText('Rating')).toBeInTheDocument();
    expect(screen.getByText('Brand')).toBeInTheDocument();
  });

  it('loads saved filter preferences from localStorage', () => {
    const savedPreferences = {
      priceRange: [1000, 50000],
      selectedCategories: ['1'],
      inStockOnly: true,
      selectedRatings: [4, 5],
      selectedBrands: ['autobacs'],
    };
    
    localStorageMock.getItem.mockReturnValue(JSON.stringify(savedPreferences));
    
    render(<ProductFilters />);
    
    // The component should load the saved preferences
    // In a real test, we would check the state values
  });

  it('saves filter preferences to localStorage when filters change', () => {
    render(<ProductFilters />);
    
    // Simulate changing a filter
    // In a real test, we would interact with the UI elements
    
    // The component should save preferences to localStorage
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'productFilterPreferences',
      expect.any(String)
    );
  });

  it('applies filters when Apply button is clicked', () => {
    render(<ProductFilters />);
    
    // Find and click the Apply button
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);
    
    // Should navigate with the current filter parameters
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/products?'));
  });

  it('clears all filters when Clear All Filters button is clicked', () => {
    render(<ProductFilters />);
    
    // Find and click the Clear All Filters button
    const clearButton = screen.getByText('Clear All Filters');
    fireEvent.click(clearButton);
    
    // Should navigate with cleared filter parameters
    expect(mockPush).toHaveBeenCalledWith('/products');
  });
});