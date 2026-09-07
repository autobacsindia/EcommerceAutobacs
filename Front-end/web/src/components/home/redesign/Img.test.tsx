/**
 * Unit tests — components/home/redesign/Img.tsx
 *
 * These pin the two attributes that decided the home page's LCP.
 *
 * `Img` defaults to `loading="lazy"` and only built a srcSet for Cloudinary
 * URLs. Once the catalog moved to R2 that meant an above-the-fold R2 image was
 * both discovered late AND fetched at full source resolution. On the live home
 * page the nav logo hit both: a 254 KB PNG, lazy, painted into a 125x48 box, and
 * Lighthouse named it the LCP element at 3.8 s.
 */
import { render, screen } from '@testing-library/react';
import Img from './Img';

const R2 = 'https://img.autobacsindia.com';
const LOGO = `${R2}/autobacs/site/roavion-primary-trimmed.png`;

beforeEach(() => { process.env.NEXT_PUBLIC_IMAGE_BASE_URL = R2; });

describe('Img — R2 responsive srcSet', () => {
  test('an R2 src WITH sizes gets a variant srcSet (the Cloudinary-only bug)', () => {
    render(<Img src={LOGO} alt="brand" sizes="200px" />);
    const img = screen.getByAltText('brand');
    expect(img).toHaveAttribute('sizes', '200px');
    // The small rungs are the whole point — this is what replaces the 254 KB PNG.
    expect(img.getAttribute('srcset')).toContain(
      `${R2}/variants/autobacs/site/roavion-primary-trimmed/w128 128w`,
    );
  });

  test('an R2 src WITHOUT sizes still ships no srcSet (contract unchanged)', () => {
    // Deliberate: React 19 hoists a preload from `src` for priority images, so
    // srcSet stays opt-in per call site rather than appearing everywhere at once.
    render(<Img src={LOGO} alt="brand" />);
    expect(screen.getByAltText('brand')).not.toHaveAttribute('srcset');
  });

  test('a Cloudinary src still gets the Cloudinary srcSet', () => {
    const cl = 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg';
    render(<Img src={cl} alt="legacy" sizes="100vw" />);
    const srcset = screen.getByAltText('legacy').getAttribute('srcset');
    expect(srcset).toContain('res.cloudinary.com');
    expect(srcset).toContain('f_auto');
  });

  test('a non-R2, non-Cloudinary src gets no srcSet', () => {
    render(<Img src="https://images.unsplash.com/photo-1?w=800" alt="stock" sizes="100vw" />);
    expect(screen.getByAltText('stock')).not.toHaveAttribute('srcset');
  });
});

describe('Img — priority', () => {
  test('priority renders eager + high fetchPriority, NOT lazy', () => {
    render(<Img src={LOGO} alt="brand" priority sizes="200px" />);
    const img = screen.getByAltText('brand');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  test('without priority it stays lazy (below-the-fold default)', () => {
    render(<Img src={LOGO} alt="brand" />);
    expect(screen.getByAltText('brand')).toHaveAttribute('loading', 'lazy');
  });
});
