/**
 * `formatPrice` — and specifically the `exact` option every campaign figure now depends on.
 *
 * Worth pinning on its own because the rule is invisible at the call sites: a card, a
 * cart line and a summary all just call `formatPrice`, and whether the paise survive
 * decides whether a shopper adding up their bag finds the number underneath it. The
 * defect this closes was a discount charged at ₹29.97 and advertised as "₹30 off".
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CurrencyProvider, useCurrency } from './CurrencyContext';

function Show({ value, exact }: { value: number; exact?: boolean }) {
  const { formatPrice } = useCurrency();
  return <span data-testid="out">{formatPrice(value, exact ? { exact: true } : undefined)}</span>;
}

const shown = (value: number, exact?: boolean) => {
  // Each call is its own mount — several assertions share one `it` below, and a leftover
  // tree would make the testid ambiguous rather than failing informatively.
  cleanup();
  render(
    <CurrencyProvider>
      <Show value={value} exact={exact} />
    </CurrencyProvider>,
  );
  return screen.getByTestId('out').textContent;
};

describe('formatPrice', () => {
  it('rounds a price to whole rupees by default — the catalogue sells nothing at ₹999.47', () => {
    expect(shown(999.47)).toBe('₹999');
  });

  it('keeps the paise when asked to be exact', () => {
    /* The figure a discount line shows has to be the figure the server resolved, or the
       lines stop summing to the total they are a breakdown of. */
    expect(shown(100.5, true)).toBe('₹100.50');
  });

  it('never rounds an exact figure upward past what is charged', () => {
    // 3% of ₹999. Default formatting shows ₹30 — a promise the cart would then break.
    expect(shown(29.97, true)).toBe('₹29.97');
    expect(shown(29.97)).toBe('₹30');
  });

  it('prints no decimals on a whole-rupee figure, even when exact', () => {
    // Otherwise every ordinary saving would read "₹1,840.00" and look like a mock-up.
    expect(shown(1840, true)).toBe('₹1,840');
  });

  it('groups in the Indian system, so a ceiling reads as it is written on the card', () => {
    expect(shown(187000)).toBe('₹1,87,000');
  });

  it('handles a sub-rupee figure without collapsing it to zero', () => {
    /* The card suppresses these as not worth a badge, but the cart itemises them —
       so the formatter must be able to render one. */
    expect(shown(0.4, true)).toBe('₹0.40');
  });
});
