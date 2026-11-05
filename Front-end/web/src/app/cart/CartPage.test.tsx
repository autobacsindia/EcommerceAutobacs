import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import CartPage from './page';
import '@testing-library/jest-dom';

// Mocks
// Cart page boundaries (auth, server quote, campaign) — keep the test offline.
jest.mock('@/context/AuthContext', () => require('@/test-utils/cartPageMocks').authGuestMock);
jest.mock('@/hooks/useCheckoutQuote', () => require('@/test-utils/cartPageMocks').checkoutQuoteIdleMock);
jest.mock('@/hooks/queries/useCampaign', () => require('@/test-utils/cartPageMocks').campaignNoneMock);
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ success: true, coupons: [] })), post: jest.fn() },
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

jest.mock('lucide-react', () => ({
  ...jest.requireActual('lucide-react'),
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Plus: () => <span data-testid="icon-plus">Plus</span>,
  Minus: () => <span data-testid="icon-minus">Minus</span>,
  ShoppingBag: () => <span data-testid="icon-bag">Bag</span>,
  ArrowRight: () => <span data-testid="icon-arrow">Arrow</span>,
}));

jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/components/layout/EnhancedImage', () => () => <img data-testid="product-image" alt="Product" />);
jest.mock('@/components/layout/SkeletonLoader', () => () => <div data-testid="skeleton-loader">Loading...</div>);

const mockRemoveFromCart = jest.fn();
const mockUpdateQuantity = jest.fn();
const mockClearCart = jest.fn();

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({
    cart: {
      items: [
        {
          product: {
            _id: '1',
            name: 'Test Product',
            price: 100,
            images: [{ url: 'img1.jpg' }],
          },
          quantity: 2,
        },
      ],
      total: 200,
    },
    removeFromCart: mockRemoveFromCart,
    updateQuantity: mockUpdateQuantity,
    clearCart: mockClearCart,
    isLoading: false,
  }),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (price: number) => `₹${price}`,
  }),
}));

// Mock confirm
global.confirm = jest.fn(() => true);

describe('CartPage Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders cart items correctly', () => {
    renderWithProviders(<CartPage />);
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText(/₹100/)).toBeInTheDocument();
    // Assuming quantity input or display is present
  });

  it('handles remove item', async () => {
    renderWithProviders(<CartPage />);
    const removeIcon = screen.getByTestId('icon-trash');
    const removeButton = removeIcon.closest('button');
    expect(removeButton).toBeInTheDocument();
    
    if (removeButton) {
      fireEvent.click(removeButton);
      expect(global.confirm).toHaveBeenCalled();
      await waitFor(() => {
        // Second arg is the variant id (undefined for a simple product).
        expect(mockRemoveFromCart).toHaveBeenCalledWith('1', undefined);
      });
    }
  });

  it('handles update quantity', async () => {
    renderWithProviders(<CartPage />);
    const plusIcon = screen.getByTestId('icon-plus');
    const plusButton = plusIcon.closest('button');
    expect(plusButton).toBeInTheDocument();
    
    if (plusButton) {
      fireEvent.click(plusButton);
      await waitFor(() => {
        expect(mockUpdateQuantity).toHaveBeenCalledWith('1', 3, undefined);
      });
    }

    const minusIcon = screen.getByTestId('icon-minus');
    const minusButton = minusIcon.closest('button');
    expect(minusButton).toBeInTheDocument();
    
    if (minusButton) {
      fireEvent.click(minusButton);
      await waitFor(() => {
        expect(mockUpdateQuantity).toHaveBeenCalledWith('1', 1, undefined);
      });
    }
  });

  it('handles clear cart', async () => {
    renderWithProviders(<CartPage />);
    const clearButton = screen.getByText(/clear cart/i); // Adjust text if needed
    fireEvent.click(clearButton);
    expect(global.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockClearCart).toHaveBeenCalled();
    });
  });
});
