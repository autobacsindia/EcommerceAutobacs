/**
 * Tests — EnhancedImage placeholder geometry.
 *
 * The component has two non-image branches (no source, and load failure). Both
 * used to hard-code `width: width || 200, height: height || 200` as an INLINE
 * style. A `fill` caller passes no width/height by definition — the image sizes
 * to its positioned parent — so both fell through to a literal 200x200, and an
 * inline style outranks the caller's `h-full w-full` classes. A broken image in
 * a 300px square cell painted a 200x200 grey box in the corner.
 *
 * That reached every `fill` caller: the PDP gallery, the vehicle grid, the cart
 * and wishlist rows. These tests pin the geometry for both sizing modes.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EnhancedImage from './EnhancedImage';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, fill, priority, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src as string} alt={alt as string} {...(rest as Record<string, unknown>)} />
  ),
}));

/**
 * Renders, then breaks the image the way a dead URL does.
 *
 * An empty `src` is NOT the way in: it resolves to the context fallback asset,
 * so the component renders an <img> and never reaches a placeholder. The branch
 * that matters in production is the one a 404 trips.
 */
function renderBroken(props: Record<string, unknown>) {
  const view = render(<EnhancedImage src="https://img.example.net/gone.jpg" alt="Storm kit" {...props} />);
  fireEvent.error(screen.getByAltText('Storm kit'));
  return view;
}

/** The component renders its placeholder as the element wrapping this copy. */
const placeholder = () => screen.getByText('Image unavailable').parentElement!;

describe('EnhancedImage placeholder', () => {
  describe('when filling a parent', () => {
    it('does not impose a fixed pixel box the caller cannot override', () => {
      renderBroken({ fill: true, context: 'product', className: 'h-full w-full object-cover' });

      const box = placeholder();
      // An inline width/height here beats every class the caller passed.
      expect(box.style.width).toBe('');
      expect(box.style.height).toBe('');
    });

    it('positions itself over the parent, the way a fill image does', () => {
      renderBroken({ fill: true, context: 'product', className: 'object-cover' });

      const box = placeholder();
      expect(box).toHaveClass('absolute', 'inset-0', 'h-full', 'w-full');
    });

    it('keeps the caller’s own classes', () => {
      renderBroken({ fill: true, context: 'product', className: 'object-contain rounded-lg' });

      expect(placeholder()).toHaveClass('object-contain', 'rounded-lg');
    });
  });

  describe('when sized explicitly', () => {
    it('still honours the width and height it was given', () => {
      renderBroken({ width: 80, height: 60, context: 'product' });

      const box = placeholder();
      expect(box.style.width).toBe('80px');
      expect(box.style.height).toBe('60px');
      expect(box).not.toHaveClass('absolute');
    });

    it('falls back to the nominal box when given no dimensions at all', () => {
      // The original behaviour, deliberately preserved for non-fill callers.
      renderBroken({ context: 'product' });

      const box = placeholder();
      expect(box.style.width).toBe('200px');
      expect(box.style.height).toBe('200px');
    });
  });
});
