import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProductFilters from './ProductFilters';
import '@testing-library/jest-dom';

// Mocks
const mockPush = jest.fn();
const mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
  }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/lib/api', () => ({
  get: jest.fn(() => Promise.resolve([])),
}));

jest.mock('@/lib/services/productService', () => ({
  getBrands: jest.fn(() => Promise.resolve([
    { _id: '1', name: 'Brand A' },
    { _id: '2', name: 'Brand B' },
  ])),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (price: number) => `₹${price}`,
  }),
}));

jest.mock('./WoofCategoryList', () => {
  return function MockWoofCategoryList({ selectedCategory, onSelectCategory }: any) {
    return (
      <div data-testid="woof-category-list">
        <button onClick={() => onSelectCategory('cat1')}>Category 1</button>
      </div>
    );
  };
});

describe('ProductFilters Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.delete('minPrice');
    mockSearchParams.delete('maxPrice');
    mockSearchParams.delete('category');
    mockSearchParams.delete('brand');
    mockSearchParams.delete('inStock');
    mockSearchParams.delete('rating');
  });

  it('renders filters correctly', async () => {
    render(<ProductFilters />);
    
    // Check for price range inputs (assuming they exist, though not seen in read code, typical for filters)
    // Or check for headings
    
    // Expand categories section
    const expandCategoriesButton = screen.getByLabelText('Expand categories');
    fireEvent.click(expandCategoriesButton);

    await waitFor(() => {
      expect(screen.getByText(/Category 1/i)).toBeInTheDocument();
    });
  });

  it('loads brands and renders them', async () => {
    render(<ProductFilters />);
    
    // Expand brands section
    const expandButton = screen.getByLabelText('Expand brands');
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText('Brand A')).toBeInTheDocument();
      expect(screen.getByText('Brand B')).toBeInTheDocument();
    });
  });

  it('handles brand selection', async () => {
    render(<ProductFilters />);
    
    // Expand brands section
    const expandButton = screen.getByLabelText('Expand brands');
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText('Brand A')).toBeInTheDocument();
    });

    // Find the checkbox by label text 'Brand A'
    // Note: The label text is just "Brand A", but it's associated with the checkbox
    const brandCheckbox = screen.getByLabelText('Brand A'); 
    fireEvent.click(brandCheckbox);
    
    // Apply filters (since there is an Apply button now, I should click it)
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
    });
    
    const pushArg = mockPush.mock.calls[0][0];
    expect(pushArg).toContain('brand=Brand+A');
  });
});
