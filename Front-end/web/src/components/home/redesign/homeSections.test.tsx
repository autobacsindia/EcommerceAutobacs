/**
 * Behaviour of the redesigned home sections — what a shopper can rely on.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Transformation from './Transformation';
import Testimonials from './Testimonials';
import ProductCard from './ProductCard';

jest.mock('./Img', () => ({ __esModule: true, default: (p: { alt?: string; className?: string }) => <img alt={p.alt} className={p.className} /> }));

const CSS = readFileSync(join(__dirname, 'home-redesign.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
});

describe('The Autobacs Effect (before / after)', () => {
  it('lets the page scroll vertically over the photo on phones', () => {
    // touch-action:none used to trap the page under a swipe that began on the photo.
    const rule = /\.hr \.split-reveal\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/touch-action:\s*pan-y/);
    expect(rule).not.toMatch(/touch-action:\s*none/);
  });

  it('is a keyboard slider that moves the divider', () => {
    render(<Transformation />);
    const slider = screen.getByRole('slider', { name: /before and after/i });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '55');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  it('offers a next step from the showcase', () => {
    render(<Transformation />);
    expect(screen.getByRole('link', { name: /plan your build/i })).toHaveAttribute('href', '/consultation');
  });
});

describe('What Enthusiasts Say', () => {
  const reviews = [
    { quote: 'Great kit.', name: 'Asha', detail: 'Roof Rack', avatar: '', rating: 4, verified: false, productHref: '/products/roof-rack' },
    { quote: 'Perfect fit.', name: 'Ravi', detail: 'LED Bar', avatar: '', rating: 5, verified: true },
  ];

  it('shows each review\'s real rating, not a blanket five stars', () => {
    render(<Testimonials testimonials={reviews} />);
    expect(screen.getByRole('img', { name: 'Rated 4 out of 5' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rated 5 out of 5' })).toBeInTheDocument();
  });

  it('says "Verified purchase" only for a verified purchase', () => {
    render(<Testimonials testimonials={reviews} />);
    expect(screen.getAllByText('Verified purchase')).toHaveLength(1);
    const ravi = screen.getByText('Ravi').closest('article') as HTMLElement;
    expect(within(ravi).getByText('Verified purchase')).toBeInTheDocument();
  });

  it('links the reviewed product when known, and shows initials instead of an empty avatar', () => {
    render(<Testimonials testimonials={reviews} />);
    expect(screen.getByRole('link', { name: /roof rack/i })).toHaveAttribute('href', '/products/roof-rack');
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});

describe("Driver's Choice card", () => {
  it('shows the details on the card body with one clear action', () => {
    render(<ProductCard p={{ category: 'Suspension', brand: 'Profender', name: 'TITAN Kit', price: '₹1,65,000', href: '/products/titan', image: '/t.jpg' }} price="₹1,65,000" />);
    const card = screen.getByRole('link', { name: /titan kit/i });
    expect(card).toHaveAttribute('href', '/products/titan');
    expect(within(card).getByText('₹1,65,000')).toBeInTheDocument();
    expect(within(card).getByText('Profender')).toBeInTheDocument();
    expect(within(card).getByText(/view/i)).toBeInTheDocument();
  });
});
