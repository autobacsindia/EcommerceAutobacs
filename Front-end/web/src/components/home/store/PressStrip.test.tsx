/**
 * The home page "As featured in" press strip.
 *
 * Pins what matters for a press feature that links to someone else's article:
 * only admin-featured items with a real http(s) link make it onto the home
 * page, the link opens the publication in a new tab (never our own copy), and
 * an empty list renders nothing at all rather than an empty heading.
 */
import { render, screen } from '@testing-library/react';
import PressStrip from './PressStrip';
import { toStorePress, PRESS_LIMIT, type StorePress } from './storeData';

const item = (over: Partial<StorePress> = {}): StorePress => ({
  id: 'p1',
  publication: 'CEO Times',
  date: 'NOV 11, 2026',
  headline: 'From a Kerala Garage to a National Platform',
  excerpt: 'How Autobacs India grew from one Kerala workshop.',
  url: 'https://ceotimes.com/article/',
  image: 'https://res.cloudinary.com/demo/image/upload/team.jpg',
  ...over,
});

describe('PressStrip', () => {
  it('renders nothing when no press is featured', () => {
    const { container } = render(<PressStrip press={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links each card out to the publication in a new tab, safely', () => {
    render(<PressStrip press={[item()]} />);
    expect(screen.getByRole('heading', { name: 'As featured in' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /From a Kerala Garage/ });
    expect(link).toHaveAttribute('href', 'https://ceotimes.com/article/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveTextContent('Read on CEO Times');
    expect(link).toHaveTextContent('NOV 11, 2026');
  });

  it('points "All press" at the /media page', () => {
    render(<PressStrip press={[item()]} />);
    expect(screen.getByRole('link', { name: 'All press' })).toHaveAttribute('href', '/media');
  });

  it('still renders a card that has no photo', () => {
    const { container } = render(<PressStrip press={[item({ image: '' })]} />);
    expect(container.querySelector('.sh-press-photo')).toBeNull();
    expect(screen.getByText('From a Kerala Garage to a National Platform')).toBeInTheDocument();
  });
});

describe('toStorePress', () => {
  const api = (over: Record<string, unknown> = {}) => ({
    _id: 'a', publication: 'CEO Times', headline: 'H', url: 'https://x.com/a', featured: true, ...over,
  });

  it('keeps only featured items, in the order the API sent them', () => {
    const out = toStorePress([api({ _id: '1' }), api({ _id: '2', featured: false }), api({ _id: '3' })]);
    expect(out.map((p) => p.id)).toEqual(['1', '3']);
  });

  it('drops items with a non-web link or missing headline/publication', () => {
    const out = toStorePress([
      api({ _id: 'js', url: 'javascript:alert(1)' }),
      api({ _id: 'rel', url: '/media' }),
      api({ _id: 'nohead', headline: '' }),
      api({ _id: 'nopub', publication: '' }),
      api({ _id: 'ok' }),
    ]);
    expect(out.map((p) => p.id)).toEqual(['ok']);
  });

  it('ignores a non-web image instead of rendering it', () => {
    expect(toStorePress([api({ image: 'data:image/png;base64,xx' })])[0].image).toBe('');
  });

  it('accepts our own site-relative photo but not a protocol-relative one', () => {
    expect(toStorePress([api({ image: '/images/press/team.webp' })])[0].image).toBe('/images/press/team.webp');
    expect(toStorePress([api({ image: '//evil.example/x.jpg' })])[0].image).toBe('');
  });

  it(`caps the strip at ${PRESS_LIMIT}`, () => {
    const many = Array.from({ length: PRESS_LIMIT + 2 }, (_, i) => api({ _id: String(i) }));
    expect(toStorePress(many)).toHaveLength(PRESS_LIMIT);
  });
});
