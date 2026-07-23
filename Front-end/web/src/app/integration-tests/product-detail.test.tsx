import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProductDetailPageClient } from '../products/[slug]/ClientPage';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/products/test',
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/analytics', () => ({
  trackProductView: jest.fn(),
}));

// Mock the heavy presentational children so the test focuses on ClientPage's own
// data-driven sections (description, features, why-choose, specifications).
jest.mock('@/components/products/redesign/Gallery', () => () => <div data-testid="gallery" />);
jest.mock('@/components/products/redesign/BuyBox', () => () => <div data-testid="buybox" />);
jest.mock('@/components/products/StickyCartBar', () => () => <div data-testid="sticky-cart" />);
jest.mock('@/components/products/VehicleCards', () => () => <div data-testid="vehicle-cards" />);
jest.mock('@/components/products/QuestionForm', () => () => <div data-testid="question-form" />);
jest.mock('@/components/products/QuestionList', () => () => <div data-testid="question-list" />);
jest.mock('@/components/products/SimilarProductsSection', () => () => <div data-testid="similar" />);
jest.mock('@/components/products/ComplementaryProductsSection', () => () => <div data-testid="complementary" />);
jest.mock('@/components/reviews', () => ({
  Reviews: () => <div data-testid="reviews">Reviews</div>,
}));

describe('Product Detail Page Integration', () => {
  const baseProduct = {
    _id: '123',
    name: 'Test Product',
    description: 'A rugged, dependable upgrade for daily driving.',
    price: 1000,
    originalPrice: 1200,
    images: [{ url: 'test.jpg', alt: 'Test Image' }],
    averageRating: 4.5,
    totalReviews: 10,
    stock: 'in' as const,
    isActive: true,
    isFeatured: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn() });
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true, user: { _id: 'user1', name: 'User' } });
  });

  it('renders real data-driven sections when the product has them', () => {
    const product = {
      ...baseProduct,
      features: ['Extra cargo space – carries more gear'],
      whyChoose: ['Reliable strength – built to last'],
      specifications: [{ key: 'Material', value: 'Powder-coated steel' }],
    };

    render(<ProductDetailPageClient product={product} />);

    expect(screen.getByRole('heading', { name: 'Product Description' })).toBeInTheDocument();
    expect(screen.getByText(/rugged, dependable upgrade/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Key Features/ })).toBeInTheDocument();
    expect(screen.getByText(/Extra cargo space/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Why Test Product/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Technical Specifications' })).toBeInTheDocument();
    expect(screen.getByText('Material')).toBeInTheDocument();
    // Kept sections still mount
    expect(screen.getByTestId('reviews')).toBeInTheDocument();
    expect(screen.getByTestId('similar')).toBeInTheDocument();
  });

  it('omits Key Features / Why Choose / Specifications when the product has none', () => {
    render(<ProductDetailPageClient product={baseProduct} />);

    expect(screen.queryByRole('heading', { name: /Key Features/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Why Choose/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Technical Specifications' })).not.toBeInTheDocument();
  });

  it('does not render fabricated marketing copy', () => {
    render(<ProductDetailPageClient product={baseProduct} />);

    expect(screen.queryByText(/Engineered for Indian Trails/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Perfect for Indian Roads/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Frequently Asked Questions/i)).not.toBeInTheDocument();
  });
});
