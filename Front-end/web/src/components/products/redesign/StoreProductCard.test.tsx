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
  useCurrency: () => ({
    // The REAL formatter's behaviour, not an approximation — see formatPriceMock.
    formatPrice: (n: number, o?: { exact?: boolean }) =>
      require('@/test-utils/formatPriceMock').formatPriceMock(n, o),
  }),
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
  it('states the saving in RUPEES, not as a rate', () => {
    /* 8% of ₹1,000. A percentage on a card is a sum the shopper has to do before they
       know whether the offer is worth anything, and it reads identically on a ₹900 mat
       and an ₹8 lakh body kit — the exact comparison a listing exists to make easy. */
    render(<StoreProductCard product={makeProduct()} campaignRate={{ percent: 8, onSaleCapped: false }} />);
    expect(screen.getByText('+₹80 off')).toBeInTheDocument();
    expect(screen.queryByText(/8%/)).not.toBeInTheDocument();
  });

  it('prices the saving off the VARIANT price the card is displaying', () => {
    /* A variable card shows "From ₹500", so its saving is a floor — flatly claiming the
       cheapest variant's figure would be wrong for every other model. */
    render(
      <StoreProductCard
        product={makeProduct({ productType: 'variable', priceMin: 500, priceMax: 2000 })}
        campaignRate={{ percent: 8, onSaleCapped: false }}
      />,
    );
    expect(screen.getByText('From +₹40 off')).toBeInTheDocument();
  });

  it('shows the paise rather than rounding the promise upward', () => {
    /* 3% of ₹999 is ₹29.97, and the cart charges exactly that. The site's default INR
       formatting rounds to whole rupees — which would advertise "₹30 off" and let the
       cart contradict the card by a paise. The whole reason for showing money instead
       of a rate is that the two agree, so this asks for the exact figure. */
    render(
      <StoreProductCard product={makeProduct({ price: 999 })} campaignRate={{ percent: 3, onSaleCapped: false }} />,
    );
    expect(screen.getByText('+₹29.97 off')).toBeInTheDocument();
  });

  it('does not print paise on a whole-rupee saving', () => {
    // "₹80.00 off" would be noise; exact formatting shows paise only where they exist.
    render(<StoreProductCard product={makeProduct()} campaignRate={{ percent: 8, onSaleCapped: false }} />);
    expect(screen.getByText('+₹80 off')).toBeInTheDocument();
  });

  it('stays silent on a saving below a rupee, rather than badging "+₹0 off"', () => {
    /* A rate on a cheap accessory can resolve to 40 paise. Rendered under the site's
       rounding that was "+₹0 off" — a badge drawing the eye to nothing. Below a rupee
       the offer is not a reason to buy. The CART still itemises every paise; this is an
       advertising threshold, not an accounting one. */
    render(<StoreProductCard product={makeProduct({ price: 40 })} campaignRate={{ percent: 1, onSaleCapped: false }} />);
    expect(screen.queryByText(/off/i)).not.toBeInTheDocument();
  });

  it('renders nothing when campaignRate is null (no campaign, or ineligible user)', () => {
    render(<StoreProductCard product={makeProduct()} campaignRate={null} />);
    expect(screen.queryByText(/off/i)).not.toBeInTheDocument();
  });

  it('renders nothing when campaignRate is omitted', () => {
    render(<StoreProductCard product={makeProduct()} />);
    expect(screen.queryByText(/off/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the rate is 0%', () => {
    render(<StoreProductCard product={makeProduct()} campaignRate={{ percent: 0, onSaleCapped: false }} />);
    expect(screen.queryByText(/off/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the rate rounds down to no money at all', () => {
    // A rate too small to move a cheap line must not print "+₹0 off".
    render(<StoreProductCard product={makeProduct({ price: 0.4 })} campaignRate={{ percent: 1, onSaleCapped: false }} />);
    expect(screen.queryByText(/off/i)).not.toBeInTheDocument();
  });

  it('hides the badge for a sold-out product even with a positive rate', () => {
    render(
      <StoreProductCard
        product={makeProduct({ stock: 'out' })}
        campaignRate={{ percent: 8, onSaleCapped: false }}
      />,
    );
    expect(screen.queryByText(/off/i)).not.toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  it('coexists with the on-sale discount badge', () => {
    render(
      <StoreProductCard
        product={makeProduct({ price: 750, originalPrice: 1000 })}
        campaignRate={{ percent: 2, onSaleCapped: true }}
      />,
    );
    // The catalogue markdown stays a percentage — it is a different claim from the
    // campaign's, and keeping the two shapes distinct is what tells them apart.
    expect(screen.getByText('-25%')).toBeInTheDocument();
    expect(screen.getByText('+₹15 off')).toBeInTheDocument();
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

/*
  The price row's layout contract.

  jsdom has no layout engine — every width here is 0 — so these tests CANNOT prove
  the button survives on a narrow card. That proof came from measuring the live
  grid in a real browser at 360/390/430px (before: the add button collapsed from
  40px to 16px and spilled outside the card on every discounted product, and on
  15 of 20 cards at 360px; after: 40px and fully inside, even with a forced
  7-figure price). What these tests do is pin the classes that produce it, so the
  fix cannot be quietly undone by an unrelated restyle — the failure is invisible
  on a desktop viewport, which is why it shipped.
*/
describe('StoreProductCard price row layout', () => {
  const priceRow = () => screen.getByText('₹1,000').closest('div')!.parentElement!;

  it('reserves the add button against a price that will not yield', () => {
    // A price is one unbreakable token, so the price block can never shrink below
    // its min-content width. Without `shrink-0` the button is the only item left
    // in the row that can absorb the deficit — and it did, down to its icon.
    render(<StoreProductCard product={makeProduct()} />);
    expect(screen.getByLabelText('Add to cart')).toHaveClass('shrink-0');
  });

  it('reserves it for the sold-out and variable variants too', () => {
    // Same row, different button — a restyle that only fixed the common case
    // would leave these two clipped.
    const { unmount } = render(<StoreProductCard product={makeProduct({ stock: 'out' })} />);
    expect(screen.getByLabelText('Add to cart')).toHaveClass('shrink-0');
    unmount();

    render(<StoreProductCard product={makeProduct({ productType: 'variable' })} />);
    expect(screen.getByLabelText('Select a model')).toHaveClass('shrink-0');
  });

  it('lets the compare-at price wrap rather than shove the button', () => {
    // MRP is the secondary figure: when both prices cannot share the line, it
    // drops to a second one. `min-w-0` is what allows the block to give at all.
    render(<StoreProductCard product={makeProduct({ originalPrice: 1500 })} />);

    const block = screen.getByText('₹1,000').parentElement!;
    expect(block).toHaveClass('min-w-0', 'flex-wrap');
    expect(screen.getByText('₹1,500')).toHaveClass('line-through');
  });

  it('steps the price type down below sm, where the card is ~165px wide', () => {
    // At 18px the widest live price (₹4,95,000 — 89.5px) did not fit the 85px a
    // phone card can offer even with no MRP beside it, so reserving the button
    // alone would only have moved the clipping onto the price itself.
    render(<StoreProductCard product={makeProduct({ originalPrice: 1500 })} />);

    expect(screen.getByText('₹1,000')).toHaveClass('text-[16px]', 'sm:text-[18px]');
    expect(screen.getByText('₹1,500')).toHaveClass('text-[11px]', 'sm:text-[12px]');
  });

  it('keeps the price and the button from touching', () => {
    render(<StoreProductCard product={makeProduct({ originalPrice: 1500 })} />);
    expect(priceRow()).toHaveClass('gap-2');
  });
});
