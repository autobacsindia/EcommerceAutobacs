import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductGrid from './ProductGrid';
import '@testing-library/jest-dom';

// Mocks
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
    toString: jest.fn(),
  }),
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

jest.mock('lucide-react', () => ({
  ShoppingCart: () => <span data-testid="icon-cart">Cart</span>,
  Heart: () => <span data-testid="icon-heart">Heart</span>,
  GitCompare: () => <span data-testid="icon-compare">Compare</span>,
}));

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({
    addToCart: jest.fn(),
  }),
}));

jest.mock('@/context/WishlistContext', () => ({
  useWishlist: () => ({
    isInWishlist: jest.fn(),
    addToWishlist: jest.fn(),
    removeFromWishlist: jest.fn(),
  }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
  }),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (price: number) => `₹${price}`,
  }),
}));

jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('./ProductCard', () => {
  return function MockProductCard({ product }: { product: any }) {
    return (
      <div data-testid="product-card">
        {product.name}
      </div>
    );
  };
});

jest.mock('@/components/skeletons/ProductCardSkeleton', () => ({
  ProductGridSkeleton: () => <div data-testid="grid-skeleton">Loading...</div>,
}));

const mockProducts = [
  {
    _id: '1',
    name: 'Product 1',
    price: 100,
    images: [{ url: 'img1.jpg' }],
    stock: 'in',
    averageRating: 4.5,
  },
  {
    _id: '2',
    name: 'Product 2',
    price: 200,
    images: [{ url: 'img2.jpg' }],
    stock: 'in',
    averageRating: 4.0,
  },
];

describe('ProductGrid Component', () => {
  it('renders loading skeleton when loading is true', () => {
    render(<ProductGrid products={[]} loading={true} />);
    expect(screen.getByTestId('grid-skeleton')).toBeInTheDocument();
  });

  it('renders product cards when products are provided', () => {
    render(<ProductGrid products={mockProducts as any} loading={false} />);
    expect(screen.getAllByTestId('product-card')).toHaveLength(2);
    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.getByText('Product 2')).toBeInTheDocument();
  });

  it('renders empty state when no products provided', () => {
    render(<ProductGrid products={[]} loading={false} />);
    expect(screen.queryByTestId('product-card')).not.toBeInTheDocument();
    // Assuming it just renders nothing or a message, but based on code it might just render nothing if map is empty
  });
});
