import React from 'react';
import { render, screen } from '@testing-library/react';
import ConsultSpecialistBanner from './ConsultSpecialistBanner';

/**
 * The banner's link used to be /consultation?ref=pdp&item=…. `ref` is the
 * affiliate code, so the middleware stored "PDP" as the shopper's affiliate and
 * overwrote the real one — and every product page minted its own crawlable URL.
 */
describe('ConsultSpecialistBanner', () => {
  const link = () => screen.getByRole('link', { name: /consult a specialist/i });

  it('carries the product as ?item= and never as an affiliate ?ref=', () => {
    render(<ConsultSpecialistBanner productSlug="hilux bull bar" />);
    const href = link().getAttribute('href')!;
    expect(href).toBe('/consultation?item=hilux%20bull%20bar');
    expect(new URL(href, 'https://shop.test').searchParams.has('ref')).toBe(false);
  });

  it('links plain /consultation without a product', () => {
    render(<ConsultSpecialistBanner />);
    expect(link().getAttribute('href')).toBe('/consultation');
  });

  it('is nofollow, so Google does not crawl one URL per product', () => {
    render(<ConsultSpecialistBanner productSlug="x" />);
    expect(link().getAttribute('rel')).toBe('nofollow');
  });
});
