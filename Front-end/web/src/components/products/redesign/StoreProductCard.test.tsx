import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  useCart: () => ({ addToCart: (...a: unknown[]) => addToCartMock(...a) }),
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

// The card owns WHICH savings it reports; the shared hook owns how that becomes a
// sentence (and the eligibility gate) — covered in useAddedToCartToast.test.tsx.
const notifyAddedMock = jest.fn();
jest.mock('@/hooks/useAddedToCartToast', () => ({
  useAddedToCartToast: () => notifyAddedMock,
}));

const addToCartMock = jest.fn();

beforeEach(() => {
  notifyAddedMock.mockReset();
  addToCartMock.mockReset();
  addToCartMock.mockResolvedValue(undefined);
});

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

/**
 * The card used to fire a flat `toast.success('Added to cart')` while already holding
 * the campaign rate it renders as a badge — so the same product added from a listing
 * congratulated the shopper on nothing, while the PDP told them what they saved.
 */
describe('StoreProductCard add-to-cart confirmation', () => {
  const clickAdd = () => fireEvent.click(screen.getByLabelText('Add to cart'));

  it('reports the campaign rate it is displaying', () => {
    render(
      <StoreProductCard
        product={makeProduct({ price: 1000 })}
        campaignRate={{ percent: 8, onSaleCapped: false }}
      />,
    );
    clickAdd();
    expect(notifyAddedMock).toHaveBeenCalledWith(
      expect.objectContaining({ price: 1000, campaignPercent: 8 }),
    );
  });

  it('reports the catalogue "was" price so a plain markdown still counts', () => {
    render(<StoreProductCard product={makeProduct({ price: 750, originalPrice: 1000 })} />);
    clickAdd();
    expect(notifyAddedMock).toHaveBeenCalledWith(
      expect.objectContaining({ price: 750, originalPrice: 1000, campaignPercent: 0 }),
    );
  });

  it('claims no campaign saving when no rate was supplied', () => {
    render(<StoreProductCard product={makeProduct()} campaignRate={null} />);
    clickAdd();
    expect(notifyAddedMock).toHaveBeenCalledWith(
      expect.objectContaining({ campaignPercent: 0 }),
    );
  });

  it('does not add — or congratulate — a sold-out product', () => {
    render(
      <StoreProductCard
        product={makeProduct({ stock: 'out' })}
        campaignRate={{ percent: 8, onSaleCapped: false }}
      />,
    );
    clickAdd();
    expect(notifyAddedMock).not.toHaveBeenCalled();
    expect(addToCartMock).not.toHaveBeenCalled();
  });

  it('sends a variable product to the PDP instead of quick-adding it', () => {
    render(
      <StoreProductCard
        product={makeProduct({ productType: 'variable' })}
        campaignRate={{ percent: 8, onSaleCapped: false }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select a model'));
    expect(notifyAddedMock).not.toHaveBeenCalled();
    expect(addToCartMock).not.toHaveBeenCalled();
  });
});
