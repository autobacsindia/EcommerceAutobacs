import React, { useState } from 'react';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import '@testing-library/jest-dom';
// page.tsx is now an async Server Component; the interactive listing is ProductsClient.
import ProductsPageClient from '@/app/products/(list)/ProductsClient';
import ProductDetailClientPage from '@/app/products/[slug]/ClientPage';
import CartPage from '@/app/cart/page';
import CheckoutPage from '@/app/checkout/page';
import apiClient from '@/lib/api';
import orderService from '@/lib/services/orderService';
import { toast } from 'react-hot-toast';
import { useRouter, usePathname, useSearchParams, useParams } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCurrency } from '@/context/CurrencyContext';

// --- Mocks ---

// Mock API Client
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  ErrorCategory: { SERVER: 'server', NETWORK: 'network', TIMEOUT: 'timeout' },
}));

// Mock Order Service
jest.mock('@/lib/services/orderService', () => ({
  createOrder: jest.fn(),
}));

// Mock Razorpay Hook
jest.mock('@/hooks/useRazorpay', () => ({
  useRazorpay: ({ onSuccess }: any) => ({
    processPayment: jest.fn(async (orderId) => {
      // Simulate successful payment
      await onSuccess(orderId);
    }),
    isProcessing: false,
  }),
}));

// Mock Toast
jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock Navigation (Dynamic Router)
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
  useParams: jest.fn(),
  usePathname: jest.fn(),
}));

// Mock Image (Next.js)
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ priority, jsx, ...props }: any) => <img {...props} />,
}));

// Mock EnhancedImage
jest.mock('@/components/layout/EnhancedImage', () => ({
  __esModule: true,
  default: ({ priority, jsx, ...props }: any) => <img {...props} alt={props.alt || 'enhanced-image'} />
}));

// Mock SkeletonLoader
jest.mock('@/components/layout/SkeletonLoader', () => () => <div data-testid="skeleton-loader">Loading...</div>);

// Mock Child Components to simplify testing
jest.mock('@/components/products/ProductGrid', () => {
  return function MockProductGrid({ products }: any) {
    const router = require('next/navigation').useRouter();
    return (
      <div data-testid="product-grid">
        {products.map((p: any) => (
          <div key={p._id} data-testid={`product-card-${p._id}`} onClick={() => router.push(`/products/${p._id}`)}>
            <h3>{p.name}</h3>
            <button onClick={(e) => {
              e.stopPropagation();
              router.push(`/products/${p._id}`);
            }}>View Details</button>
          </div>
        ))}
      </div>
    );
  };
});

// The redesigned listing renders StoreProductCard per product.
jest.mock('@/components/products/redesign/StoreProductCard', () => {
  return function MockStoreProductCard({ product }: any) {
    const router = require('next/navigation').useRouter();
    return (
      <div data-testid={`product-card-${product._id}`} onClick={() => router.push(`/products/${product._id}`)}>
        <h3>{product.name}</h3>
      </div>
    );
  };
});
jest.mock('@/components/products/redesign/Filters', () => () => <div data-testid="product-filters">Filters</div>);

jest.mock('@/components/products/ProductFilters', () => () => <div data-testid="product-filters">Filters</div>);
jest.mock('@/components/vehicles/VehicleFilterSidebar', () => () => <div data-testid="vehicle-filter">Vehicle Filter</div>);

// Mock PaymentMethodSelector
jest.mock('@/components/checkout/PaymentMethodSelector', () => {
  return function MockPaymentMethodSelector({ selectedMethod, onSelect }: any) {
    return (
      <div data-testid="payment-method-selector">
        <button onClick={() => onSelect('cod')}>Cash on Delivery</button>
        <button onClick={() => onSelect('razorpay')}>Razorpay</button>
      </div>
    );
  };
});

// Mock Cart Context
const mockAddToCart = jest.fn();
const mockUpdateQuantity = jest.fn();
const mockRemoveFromCart = jest.fn();
const mockClearCart = jest.fn();

jest.mock('@/context/CartContext', () => ({
  useCart: jest.fn(),
}));

// Mock Auth Context
jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock Wishlist Context
jest.mock('@/context/WishlistContext', () => ({
  useWishlist: jest.fn(),
}));

// Mock Currency Context
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: jest.fn(),
}));

// --- Test Data ---
const mockProducts = [
  {
    _id: 'p1',
    name: 'Test Product 1',
    price: 100,
    description: 'Description 1',
    images: [{ url: 'img1.jpg' }],
    category: { _id: 'c1', name: 'Category 1', slug: 'cat-1' },
    stock: 'in',
    isActive: true,
    averageRating: 4.5,
    totalReviews: 10,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'p2',
    name: 'Test Product 2',
    price: 200,
    description: 'Description 2',
    images: [{ url: 'img2.jpg' }],
    category: { _id: 'c2', name: 'Category 2', slug: 'cat-2' },
    stock: 'in',
    isActive: true,
    averageRating: 4.0,
    totalReviews: 5,
    createdAt: new Date().toISOString(),
  },
];

const mockProductDetail = { ...mockProducts[0], specifications: [], features: [], qna: [] };

let currentPath = '/products';
let currentSearchParams = new URLSearchParams();

// --- Test Suite ---

describe('User Journey Integration Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentPath = '/products';
    currentSearchParams = new URLSearchParams();
    
    // Setup Context Mocks
    (useCart as jest.Mock).mockReturnValue({
      cart: {
        items: [
          { product: { _id: 'p1', name: 'Test Product 1', price: 100, images: [{ url: 'img1.jpg' }] }, quantity: 1 }
        ],
        total: 100,
      },
      addToCart: mockAddToCart,
      updateQuantity: mockUpdateQuantity,
      removeFromCart: mockRemoveFromCart,
      clearCart: mockClearCart,
      isLoading: false,
    });

    (useAuth as jest.Mock).mockReturnValue({
      user: { name: 'Test User', email: 'test@example.com' },
      isAuthenticated: true,
      isLoading: false,
      login: jest.fn(),
      logout: jest.fn(),
    });

    (useWishlist as jest.Mock).mockReturnValue({
      wishlist: [],
      addToWishlist: jest.fn(),
      removeFromWishlist: jest.fn(),
      isInWishlist: jest.fn().mockReturnValue(false),
    });

    (useCurrency as jest.Mock).mockReturnValue({
      currency: 'INR',
      setCurrency: jest.fn(),
      exchangeRate: 1,
      formatPrice: (price: number) => `₹${price}`,
    });
    
    // Setup API mocks
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url.startsWith('/products/p1') || url.startsWith('/products/slug/p1')) {
        return Promise.resolve({ product: mockProductDetail });
      }
      if (url.startsWith('/products')) return Promise.resolve({ 
        products: mockProducts, 
        pagination: { total: 2, pages: 1, currentPage: 1, count: 2 } 
      });
      // Server price check run before an order is placed.
      if (url.startsWith('/cart/validate')) return Promise.resolve({
        success: true, isValid: true, subtotal: 100, tax: 18, total: 118,
        items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }],
      });
      if (url.startsWith('/cart')) return Promise.resolve({ items: [], total: 0 });
      // Return empty addresses to trigger address form
      if (url.startsWith('/profile')) return Promise.resolve({ success: true, user: { addresses: [] } });
      if (url.includes('/summary')) return Promise.resolve({ 
        summary: { averageRating: 4.5, totalReviews: 10, ratingDistribution: { 5: 5, 4: 5, 3: 0, 2: 0, 1: 0 } } 
      });
      if (url.startsWith('/reviews')) return Promise.resolve({ 
        reviews: [], 
        pagination: { currentPage: 1, totalPages: 1, totalReviews: 0, hasNext: false, hasPrev: false } 
      });
      if (url.startsWith('/product-questions')) return Promise.resolve({ questions: [] });
      return Promise.resolve({});
    });

    // Checkout's cart step POSTs a server stock check before it lets you continue.
    (apiClient.post as jest.Mock).mockImplementation(async (url: string) =>
      typeof url === 'string' && url.includes('validate')
        ? { success: true, isValid: true, validationErrors: [] }
        : { success: true, order: { _id: 'order_123', totalAmount: 118 } });

    (apiClient.put as jest.Mock).mockImplementation((url) => {
      if (url.startsWith('/profile')) return Promise.resolve({ success: true });
      return Promise.resolve({});
    });

    (orderService.createOrder as jest.Mock).mockResolvedValue({
      success: true,
      order: { _id: 'order_123', totalAmount: 118 }
    });
  });

  // Helper to render the "App" based on current path
  const renderApp = () => {
    // Configure mocks based on current path
    (usePathname as jest.Mock).mockReturnValue(currentPath);
    (useSearchParams as jest.Mock).mockReturnValue(currentSearchParams);
    (useParams as jest.Mock).mockImplementation(() => {
       const match = currentPath.match(/\/products\/([^\/]+)/);
       return match ? { id: match[1] } : {};
    });
    
    // We need to provide the router mock with push function
    const pushMock = jest.fn((path) => {
      currentPath = path;
    });
    (useRouter as jest.Mock).mockReturnValue({
      push: pushMock,
      refresh: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
    });

    // This is a simplified simulation of routing
    if (currentPath.startsWith('/products/p1')) {
      return { 
        ...renderWithProviders(<ProductDetailClientPage slug="p1" />),
        mockPush: pushMock 
      };
    } else if (currentPath === '/cart') {
      return { 
        ...renderWithProviders(<CartPage />),
        mockPush: pushMock 
      };
    } else if (currentPath === '/checkout') {
      return { 
        ...renderWithProviders(<CheckoutPage />),
        mockPush: pushMock 
      };
    } else {
      return { 
        ...renderWithProviders(<ProductsPageClient />),
        mockPush: pushMock 
      };
    }
  };

  it('navigates from product listing to detail page', async () => {
    // 1. Start at Products Listing
    const { unmount, mockPush: initialMockPush } = renderApp();

    await waitFor(() => {
      expect(screen.getByText('Test Product 1')).toBeInTheDocument();
      expect(screen.getByText('Test Product 2')).toBeInTheDocument();
    });

    // 2. Click on a product to view details
    fireEvent.click(screen.getByTestId('product-card-p1'));

    expect(initialMockPush).toHaveBeenCalledWith('/products/p1');
    
    // 3. Simulate navigation by re-rendering with new path
    unmount();
    renderApp(); 

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Test Product 1/i })).toBeInTheDocument();
      expect(screen.getByText(/Description 1/i)).toBeInTheDocument();
    });
    
    expect(await screen.findByRole('button', { name: /add to cart/i })).toBeInTheDocument();
  });

  it('adds product to cart from detail page', async () => {
    // Setup: Start at Detail Page directly
    currentPath = '/products/p1';
    renderApp();

    const btn = await screen.findByRole('button', { name: /add to cart/i });
    expect(btn).not.toBeDisabled();

    // Action: Click Add to Cart
    fireEvent.click(btn);

    // Assert: product id, qty, display snapshot, and no variant (simple product).
    await waitFor(() => {
      expect(mockAddToCart).toHaveBeenCalledWith('p1', 1, expect.objectContaining({ name: 'Test Product 1' }), null);
    });
  });

  it('displays cart items on cart page', async () => {
    // Setup: Start at Cart Page
    currentPath = '/cart';
    renderApp();

    // Verify rendering with findByText (auto-waits)
    await screen.findByText(/Order Summary/i);
    await screen.findByText(/Shopping Cart/i);
    await screen.findByText(/Test Product 1/i);
    
    const prices = await screen.findAllByText(/100/);
    expect(prices.length).toBeGreaterThan(0);
  });

  it('completes checkout flow successfully', async () => {
    // Setup: Start at Checkout Page
    currentPath = '/checkout';
    const { mockPush } = renderApp();

    // Verify we are on Checkout page
    await screen.findByText(/Checkout/i);

    // Verify Step 1: Cart Review
    await screen.findByText(/Review Your Cart/i);
    await screen.findByText(/Test Product 1/i);
    
    // Proceed to Address
    const continueBtn = await screen.findByText(/Continue to Shipping/i);
    fireEvent.click(continueBtn);
    
    // 2. Address Step
    await screen.findByText(/Shipping Address/i);

    // Since mock profile returns no addresses, form should be visible
    const nameInput = screen.getByPlaceholderText(/Full Name/i);
    fireEvent.change(nameInput, { target: { value: 'Test User' } });
    
    fireEvent.change(screen.getByPlaceholderText(/Street Address/i), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByPlaceholderText(/City/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/State/i), { target: { value: 'MH' } });
    fireEvent.change(screen.getByPlaceholderText(/Postal Code/i), { target: { value: '400001' } });
    fireEvent.change(screen.getByPlaceholderText(/Phone/i), { target: { value: '9876543210' } });

    // Click "Continue to Payment"
    const paymentBtn = await screen.findByText(/Continue to Payment/i);
    fireEvent.click(paymentBtn);

    // 3. Payment Step
    await screen.findByText(/Payment Method/i);
    await screen.findByTestId('payment-method-selector');

    // Razorpay is the only payment method (COD was removed).
    fireEvent.click(screen.getByText(/^Razorpay$/));
    
    // Click "Continue to Review"
    const reviewBtn = await screen.findByText(/Continue to Review/i);
    fireEvent.click(reviewBtn);

    // 4. Review Step
    await screen.findByText(/Review Your Order/i);
    await screen.findByText(/Order Summary/i);

    // Click "Place Order" — gated on accepting the Terms.
    fireEvent.click(screen.getByRole('checkbox', { name: /accept the Terms and Conditions/i }));
    const placeOrderBtn = await screen.findByText(/Place Order/i);
    fireEvent.click(placeOrderBtn);

    // 5. Success: the order is created server-side, the (mocked) Razorpay window
    // reports success, and the page hands off to the dedicated success page.
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/orders', expect.objectContaining({ paymentMethod: 'razorpay' }));
      expect(mockPush).toHaveBeenCalledWith('/order/order_123/success');
    });
    expect(mockClearCart).toHaveBeenCalled();
  });
});
