/**
 * A priority image must be visible in the server HTML.
 *
 * EnhancedImage fades photos in: opacity-0 until React has hydrated and seen the
 * `load` event. For the above-the-fold photo `priority` is set on — a product grid's
 * first row, the page's Largest Contentful Paint — that meant the photo stayed
 * invisible behind every script on the page, however early it had downloaded.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EnhancedImage from './EnhancedImage';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, fill, priority, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src as string} alt={alt as string} {...(rest as Record<string, unknown>)} />
  ),
}));

describe('EnhancedImage fade-in', () => {
  it('shows a priority image immediately, before any load event', () => {
    render(<EnhancedImage src="https://img.example.net/kit.jpg" alt="Kit" priority />);
    const img = screen.getByAltText('Kit');
    expect(img).toHaveClass('opacity-100');
    expect(img).not.toHaveClass('opacity-0');
  });

  it('still fades in an ordinary (lazy) image once it has loaded', () => {
    render(<EnhancedImage src="https://img.example.net/kit.jpg" alt="Kit" />);
    expect(screen.getByAltText('Kit')).toHaveClass('opacity-0');
  });
});
