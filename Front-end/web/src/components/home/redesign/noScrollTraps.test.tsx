/**
 * The home page must scroll like any other page. Two sections used to pin it:
 *   - the hero: a 300vh (phones 180vh) track with a sticky stage that froze the page
 *     while the car frames scrubbed against the scroll;
 *   - Shop by Category: a sticky 100vh panel inside a ~3,700px track that turned the
 *     page's vertical scroll into sideways card movement.
 * Customers read both as the site being stuck. These pin that neither comes back.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CategoriesScroll from './CategoriesScroll';

jest.mock('./Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));

// Comments stripped: they legitimately describe the old 300vh track.
const CSS = readFileSync(join(__dirname, 'home-redesign.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule whose selector mentions `needle`, as "selector { body }". */
const rulesFor = (needle: string) =>
  [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].includes(needle))
    .map((m) => `${m[1].trim()} { ${m[2].trim()} }`);

describe('no scroll traps in the stylesheet', () => {
  it('the hero is never sticky and has no tall scroll track', () => {
    for (const rule of [...rulesFor('.hero-pin'), ...rulesFor('.hr .hero ')]) {
      if (/prefers-reduced-motion/.test(rule)) continue;
      expect(rule).not.toMatch(/position:\s*sticky/);
      expect(rule).not.toMatch(/height:\s*(10[1-9]|1[1-9][0-9]|[2-9][0-9]{2})s?vh/); // taller than one screen
    }
  });

  it('the category gallery is never sticky', () => {
    for (const rule of rulesFor('.categories-scroll')) {
      expect(rule).not.toMatch(/position:\s*sticky/);
    }
  });
});

describe('category row', () => {
  const cats = Array.from({ length: 6 }, (_, i) => ({
    name: `Cat ${i + 1}`, href: `/categories/c${i + 1}`, image: `/c${i + 1}.jpg`, tag: 'Tag',
  }));

  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  });

  it('never listens to page scroll', () => {
    const add = jest.spyOn(window, 'addEventListener');
    render(<CategoriesScroll categories={cats as never} />);
    expect(add.mock.calls.map((c) => c[0])).not.toContain('scroll');
    add.mockRestore();
  });

  it('keeps every category link, and the arrows move the row by a card', async () => {
    const { container } = render(<CategoriesScroll categories={cats as never} />);
    for (const c of cats) expect(screen.getByRole('link', { name: new RegExp(c.name) })).toHaveAttribute('href', c.href);
    expect(screen.getByRole('link', { name: /view all categories/i })).toHaveAttribute('href', '/categories');

    const track = container.querySelector('.cat-track') as HTMLElement;
    const scrollBy = jest.fn();
    track.scrollBy = scrollBy as never;
    // jsdom has no layout: give the row something to scroll.
    Object.defineProperty(track, 'scrollWidth', { configurable: true, value: 3000 });
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 1000 });
    fireEvent.scroll(track);
    const next = screen.getByRole('button', { name: /more categories/i });
    await waitFor(() => expect(next).not.toBeDisabled());
    expect(screen.getByRole('button', { name: /previous categories/i })).toBeDisabled(); // at the start

    fireEvent.click(next);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }));
    expect(scrollBy.mock.calls[0][0].left).toBeGreaterThan(0);
  });
});
