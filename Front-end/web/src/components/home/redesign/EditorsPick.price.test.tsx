/**
 * Tests — Editor's Pick price rendering.
 *
 * This section takes its items from two very different places: catalogue rows
 * mapped in `homeData.ts`, and hand-written curated fallbacks in
 * `homeContent.ts` used when the API returns nothing. Only the first has a
 * number behind it. The home page was previously the one storefront surface the
 * currency switch could not reach, because the price arrived pre-formatted as a
 * server-rendered string with the figure thrown away.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import EditorsPick from './EditorsPick';
import type { ProductItem } from './homeContent';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, fill, priority, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src as string} alt={alt as string} {...(rest as Record<string, unknown>)} />
  ),
}));

let currency: 'INR' | 'USD' = 'INR';
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (n: number, o?: { exact?: boolean }) =>
      currency === 'INR'
        ? require('@/test-utils/formatPriceMock').formatPriceMock(n, o)
        : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 83),
  }),
}));

beforeEach(() => {
  currency = 'INR';
});

const catalogueRow: ProductItem = {
  category: 'Suspension',
  brand: 'Profender',
  name: 'Storm Series Kit',
  price: '₹2,68,000', // what the server rendered
  priceValue: 268000, // what it was rendered FROM
  href: '/products/storm',
  image: '/storm.jpg',
};

/** Both breakpoint variants render; assert against one to avoid double matches. */
const anyPrice = (text: string) => screen.getAllByText(text).length > 0;

describe("Editor's Pick price", () => {
  it('formats a catalogue price through CurrencyContext, not from the server string', () => {
    // The server string and the formatted number agree here, so the only way to
    // tell them apart is to change the currency — the next test.
    render(<EditorsPick products={[catalogueRow]} />);
    expect(anyPrice('₹2,68,000')).toBe(true);
  });

  it('follows the currency switch, which the server-formatted string could not', () => {
    currency = 'USD';
    render(<EditorsPick products={[catalogueRow]} />);

    expect(anyPrice('$3,228.92')).toBe(true);
    // The stale rupee string must not survive alongside it.
    expect(screen.queryByText('₹2,68,000')).not.toBeInTheDocument();
  });

  it('still renders a curated fallback that has no number behind it', () => {
    // homeContent's placeholders are copy, not catalogue rows: no `priceValue`,
    // so the card must fall back to the written string instead of blanking.
    currency = 'USD';
    const curated: ProductItem = { ...catalogueRow, priceValue: undefined, price: '₹1,20,000' };
    render(<EditorsPick products={[curated]} />);

    expect(anyPrice('₹1,20,000')).toBe(true);
  });

  it('renders a price in both breakpoint variants, since CSS picks the visible one', () => {
    // EditorsPick ships the desktop track AND the phone carousel, choosing by CSS
    // so the right one is already in the SSR HTML. A price fixed in only one of
    // them would look correct on exactly one class of device.
    render(<EditorsPick products={[catalogueRow]} />);
    expect(screen.getAllByText('₹2,68,000')).toHaveLength(2);
  });
});
