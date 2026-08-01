/**
 * The mobile sticky bar is the only add-to-cart on a phone once the shopper
 * scrolls past the BuyBox — so when it fired no ad-platform event (as it did
 * originally), most real add_to_cart signals vanished with nothing to show for
 * it: the cart still filled, the toast still appeared, and only Google Ads and
 * Meta knew anything was missing. These tests pin that wiring down.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StickyCartBar from './StickyCartBar';

const mockAddToCart = jest.fn();
const mockPush = jest.fn();

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({ addToCart: mockAddToCart }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-hot-toast', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, whileTap, ...props }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const mockTrackAddToCart = jest.fn();
const mockTrackGoogleAddToCart = jest.fn();
jest.mock('@/lib/metaPixel', () => ({
  trackAddToCart: (...args: unknown[]) => mockTrackAddToCart(...args),
}));
jest.mock('@/lib/googleAdsEvents', () => ({
  trackGoogleAddToCart: (...args: unknown[]) => mockTrackGoogleAddToCart(...args),
}));

const PRODUCT = {
  _id: 'p1',
  name: 'Beast 230 Driving Light',
  price: 4999,
  stock: 'in' as const,
  metaContentId: '11466',
};

/** The bar only mounts past 600px of scroll. */
function renderScrolled(props: Partial<React.ComponentProps<typeof StickyCartBar>> = {}) {
  const view = render(<StickyCartBar product={PRODUCT} {...props} />);
  window.scrollY = 900;
  fireEvent.scroll(window);
  return view;
}

describe('StickyCartBar ad-platform tracking', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fires add_to_cart on both platforms with the catalogue id', async () => {
    mockAddToCart.mockResolvedValue(undefined);
    renderScrolled();

    fireEvent.click(await screen.findByRole('button', { name: /add/i }));

    await waitFor(() => expect(mockTrackGoogleAddToCart).toHaveBeenCalledWith('11466', 4999, 1));
    expect(mockTrackAddToCart).toHaveBeenCalledWith('11466', 4999, 1);
  });

  it('reports the SELECTED variant id and price, not the parent product', async () => {
    mockAddToCart.mockResolvedValue(undefined);
    renderScrolled({
      isVariable: true,
      variant: { _id: 'v2', label: 'Amber', price: 5499, stock: 'in', metaContentId: '11470' },
    });

    fireEvent.click(await screen.findByRole('button', { name: /add/i }));

    await waitFor(() => expect(mockTrackGoogleAddToCart).toHaveBeenCalledWith('11470', 5499, 1));
  });

  it('tracks Buy now too — it adds to the cart just the same', async () => {
    mockAddToCart.mockResolvedValue(undefined);
    renderScrolled();

    fireEvent.click(await screen.findByRole('button', { name: /buy/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/checkout'));
    expect(mockTrackGoogleAddToCart).toHaveBeenCalledWith('11466', 4999, 1);
  });

  it('does not track when the add fails — no phantom signal', async () => {
    mockAddToCart.mockRejectedValue(new Error('out of stock'));
    renderScrolled();

    fireEvent.click(await screen.findByRole('button', { name: /add/i }));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    expect(mockTrackGoogleAddToCart).not.toHaveBeenCalled();
    expect(mockTrackAddToCart).not.toHaveBeenCalled();
  });

  it('skips tracking rather than sending an id Google cannot match', async () => {
    mockAddToCart.mockResolvedValue(undefined);
    const { _id, name, price, stock } = PRODUCT;
    render(<StickyCartBar product={{ _id, name, price, stock }} />);
    window.scrollY = 900;
    fireEvent.scroll(window);

    fireEvent.click(await screen.findByRole('button', { name: /add/i }));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    expect(mockTrackGoogleAddToCart).not.toHaveBeenCalled();
  });
});
