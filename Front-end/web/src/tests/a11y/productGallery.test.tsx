/**
 * Accessibility contract for the PDP gallery.
 *
 * The magnifier is hover-only by design, which makes it invisible to keyboard
 * and screen-reader users. That is acceptable ONLY because every image stays
 * reachable another way — a real button on the main frame, a labelled thumbnail
 * rail, and a fullscreen viewer with its own controls. These tests exist to stop
 * a future refactor from quietly removing that second path.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { testAccessibility } from '@/tests/utils/a11y';
import Gallery, { type GalleryImage } from '@/components/products/redesign/Gallery';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, fill, priority, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src as string} alt={alt as string} {...(rest as Record<string, unknown>)} />
  ),
}));

const images: GalleryImage[] = [
  { src: 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg', alt: 'Roav bumper, front' },
  { src: 'https://res.cloudinary.com/demo/image/upload/v1/b.jpg', alt: 'Roav bumper, side' },
  { src: 'https://res.cloudinary.com/demo/image/upload/v1/c.jpg', alt: 'Roav bumper, fitted' },
];

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

describe('PDP gallery - accessibility', () => {
  it('has no violations at rest', async () => {
    const { container } = render(<Gallery images={images} name="Roav bumper" />);
    await testAccessibility(container);
  });

  it('has no violations with the fullscreen viewer open', async () => {
    const { container } = render(<Gallery images={images} name="Roav bumper" />);
    fireEvent.click(screen.getByTestId('gallery-zoom'));
    await testAccessibility(container);
  });

  it('gives every control a discernible name', () => {
    render(<Gallery images={images} name="Roav bumper" />);

    for (const control of screen.getAllByRole('button')) {
      expect(control).toHaveAccessibleName();
    }
  });

  it('names the viewer and its controls once open', () => {
    render(<Gallery images={images} name="Roav bumper" />);
    fireEvent.click(screen.getByTestId('gallery-zoom'));

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Roav bumper image viewer');
    expect(screen.getByRole('button', { name: 'Close image viewer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next image' })).toBeInTheDocument();
  });

  it('exposes the alt text of the image actually on screen', () => {
    // Thumbnails carry `alt=""` on purpose — their button label already names
    // them, and a duplicate announcement is noise, not information.
    render(<Gallery images={images} name="Roav bumper" />);

    expect(screen.getAllByAltText('Roav bumper, front').length).toBeGreaterThan(0);
    expect(screen.getAllByAltText('')).toHaveLength(images.length);
  });
});
