/**
 * Regression: a src next/image cannot parse ("photo.jpg", "//cdn/x") must fall
 * back to the context picture. The real next/image THROWS on those, and on the
 * checkout page that throw replaced the whole checkout with an error screen.
 * Uses the real next/image on purpose — the mock would never throw.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EnhancedImage from './EnhancedImage';

const srcOf = (alt: string) => decodeURIComponent(screen.getByAltText(alt).getAttribute('src') || '');

describe('EnhancedImage — sources next/image would throw on', () => {
  it.each(['photo.jpg', 'images/x.webp', '//cdn.autobacsindia.com/x.webp', 'javascript:alert(1)'])(
    'falls back instead of crashing for %p',
    (bad) => {
      render(<EnhancedImage src={bad} alt="Kit" width={64} height={64} context="product" />);
      expect(srcOf('Kit')).toContain('/images/fallback-product');
    },
  );

  it('keeps absolute and root-relative sources', () => {
    render(<EnhancedImage src="https://images.autobacsindia.com/a.webp" alt="Abs" width={64} height={64} />);
    render(<EnhancedImage src="/images/vehicles/x.webp" alt="Rel" width={64} height={64} />);
    expect(srcOf('Abs')).toContain('https://images.autobacsindia.com/a.webp');
    expect(srcOf('Rel')).toContain('/images/vehicles/x.webp');
  });
});
