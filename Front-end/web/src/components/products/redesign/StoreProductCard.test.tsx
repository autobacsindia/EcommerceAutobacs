import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StoreProductCard from './StoreProductCard';
import type { Product } from '@/lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('@/components/products/ProductImage', () => {
  return function MockProductImage({ alt }: { alt: string }) {
    return <img alt={alt} />;
  };
});

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({ addToCart: jest.fn() }),
}));

jest.mock('@/context/WishlistContext', () => ({
  useWishlist: () => ({
    isInWishlist: () => false,
    addToWishlist: jest.fn(),
    removeFromWishlist: jest.fn(),
  }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n}` }),
}));

jest.mock('react-hot-toast', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test Product',
    price: 1000,
    images: [{ url: '/test.jpg' }],
    stock: 'in',
    averageRating: 0,
    ...overrides,
  } as Product;
}

describe('StoreProductCard campaign badge', () => {
  it('renders the festive rate when campaignRate is provided', () => {
    render(<StoreProductCard product={makeProduct()} campaignRate={{ percent: 8, onSaleCapped: false }} />);
    expect(screen.getByText('+8% festive')).toBeInTheDocument();
  });

  it('renders nothing when campaignRate is null (no campaign, or ineligible user)', () => {
    render(<StoreProductCard product={makeProduct()} campaignRate={null} />);
    expect(screen.queryByText(/festive/i)).not.toBeInTheDocument();
  });

  it('renders nothing when campaignRate is omitted', () => {
    render(<StoreProductCard product={makeProduct()} />);
    expect(screen.queryByText(/festive/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the rate is 0%', () => {
    render(<StoreProductCard product={makeProduct()} campaignRate={{ percent: 0, onSaleCapped: false }} />);
    expect(screen.queryByText(/festive/i)).not.toBeInTheDocument();
  });

  it('hides the badge for a sold-out product even with a positive rate', () => {
    render(
      <StoreProductCard
        product={makeProduct({ stock: 'out' })}
        campaignRate={{ percent: 8, onSaleCapped: false }}
      />,
    );
    expect(screen.queryByText(/festive/i)).not.toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  it('coexists with the on-sale discount badge', () => {
    render(
      <StoreProductCard
        product={makeProduct({ price: 750, originalPrice: 1000 })}
        campaignRate={{ percent: 2, onSaleCapped: true }}
      />,
    );
    expect(screen.getByText('-25%')).toBeInTheDocument();
    expect(screen.getByText('+2% festive')).toBeInTheDocument();
  });
});
