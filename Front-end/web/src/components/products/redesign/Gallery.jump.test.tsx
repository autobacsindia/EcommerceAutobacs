/**
 * Tests — Gallery `jumpTo`.
 *
 * Picking a model must move the gallery to that model's photo. Equally
 * important, and easier to get wrong: NOTHING else may move it. A gallery that
 * snaps back while a shopper is swiping is worse than one that never jumps, so
 * both directions are pinned here.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Gallery from './Gallery';

// next/image → a plain img, so `src` is directly assertable.
jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as never)} />,
}));

const images = [
  { src: '/pack.jpg', alt: 'pack' },
  { src: '/oncar.jpg', alt: 'oncar' },
  { src: '/smoked.jpg', alt: 'smoked' },
  { src: '/clear.jpg', alt: 'clear' },
];

/** The thumbnail marked current is the gallery's selection, whatever renders it. */
const selectedThumb = () =>
  screen.getAllByRole('button', { current: true })[0]?.getAttribute('aria-label') ?? null;

describe('Gallery jumpTo', () => {
  test('renders the first image with no jump requested', () => {
    render(<Gallery images={images} name="Tail Lights" jumpTo={null} />);
    expect(screen.getAllByAltText(/pack/i).length).toBeGreaterThan(0);
  });

  test('moves to the model image when a model is selected', () => {
    const { rerender } = render(<Gallery images={images} name="T" jumpTo={null} />);
    rerender(<Gallery images={images} name="T" jumpTo={2} />);
    expect(selectedThumb()).toMatch(/3/);
  });

  test('moves again when a DIFFERENT model is picked', () => {
    const { rerender } = render(<Gallery images={images} name="T" jumpTo={2} />);
    rerender(<Gallery images={images} name="T" jumpTo={3} />);
    expect(selectedThumb()).toMatch(/4/);
  });

  test('a re-render with the SAME jumpTo does not fight the shopper', () => {
    // The shopper jumped to slide 3, then swiped to slide 1. An unrelated parent
    // re-render must not drag them back.
    const { rerender } = render(<Gallery images={images} name="T" jumpTo={2} />);
    fireEvent.click(screen.getAllByRole('button', { name: /1/ })[0]);
    const afterSwipe = selectedThumb();

    rerender(<Gallery images={images} name="T" jumpTo={2} onSale />);
    expect(selectedThumb()).toBe(afterSwipe);
  });

  test('clearing the selection leaves the gallery where it is', () => {
    const { rerender } = render(<Gallery images={images} name="T" jumpTo={3} />);
    rerender(<Gallery images={images} name="T" jumpTo={null} />);
    expect(selectedThumb()).toMatch(/4/);
  });

  test('an imageless product still renders its placeholder', () => {
    render(<Gallery images={[]} name="T" jumpTo={null} />);
    expect(screen.getByText(/no image/i)).toBeInTheDocument();
  });
});
