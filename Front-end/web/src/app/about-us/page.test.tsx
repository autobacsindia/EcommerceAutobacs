import React from 'react';
import { render, screen, within } from '@testing-library/react';

import AboutUsPage from './page';

// framer-motion (via Reveal) animates on scroll; jsdom has no IntersectionObserver
// for whileInView, so render children straight through.
jest.mock('@/components/ui/Reveal', () => ({
  __esModule: true,
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// next/font is a build-time transform with no runtime implementation under Jest.
jest.mock('next/font/google', () => ({
  Bebas_Neue: () => ({ variable: 'font-bebas', className: 'font-bebas' }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  // Drop the next/image-only props so React doesn't warn about unknown <img> attributes.
  default: ({ fill, priority, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...(rest as object)} />
  ),
}));

describe('AboutUsPage', () => {
  it('leads with the positioning line from the copy deck', () => {
    render(<AboutUsPage />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('We didn’t enter the Indian aftermarket.');
    expect(heading).toHaveTextContent('We built it.');
  });

  it('tells the story in order — 2015, 2016, 2017, 2022', () => {
    const { container } = render(<AboutUsPage />);
    const text = container.textContent ?? '';

    const years = ['2015 · Bangkok', '2016 · Kollam, Kerala', '2017 ·', '2022 ·'];
    const positions = years.map((y) => text.indexOf(y));

    positions.forEach((pos, i) => expect(pos).toBeGreaterThanOrEqual(0));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  // The figures are the claim the business is making publicly — a silent drift
  // here (e.g. the old page's "15+ years / 50K+ clients") is a credibility bug.
  it('states every figure from the numbers block', () => {
    render(<AboutUsPage />);
    const stats = screen.getByTestId('about-stats');

    expect(within(stats).getByText(/Customers served/)).toBeInTheDocument();
    expect(within(stats).getByText(/Vehicle builds completed/)).toBeInTheDocument();
    expect(within(stats).getByText(/Orders shipped/)).toBeInTheDocument();
    expect(within(stats).getByText(/Installation points across India/)).toBeInTheDocument();
    expect(within(stats).getByText(/People across India, Bangkok & China/)).toBeInTheDocument();
    expect(within(stats).getByText(/In the market/)).toBeInTheDocument();

    // Counters settle on the real values (no IntersectionObserver in jsdom →
    // they render immediately rather than sticking at zero).
    expect(within(stats).getAllByText('10,000+')).toHaveLength(2);
    expect(within(stats).getByText('1,200+')).toBeInTheDocument();
    expect(within(stats).getByText('42')).toBeInTheDocument();
    expect(within(stats).getByText('200+')).toBeInTheDocument();
    // Eleven, not ten — the hero says "Eleven years ago" and the two must agree.
    expect(within(stats).getByText('11 yrs')).toBeInTheDocument();
  });

  it('offers every call to action from the copy deck, pointing at real routes', () => {
    render(<AboutUsPage />);

    const expected: Array<[RegExp, string]> = [
      [/talk to a build consultant/i, '/consultation'],
      [/see our work/i, '/media'],
      [/shop now/i, '/products'],
      [/book a consultation/i, '/consultation'],
      [/partner with us/i, '/contact?subject=Dealer%20%26%20installation%20partnership'],
      [/^enquire$/i, '/contact?subject=B2B%20%26%20showroom%20supply%20enquiry'],
      [/contact us/i, '/contact'],
    ];

    expected.forEach(([name, href]) => {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    });
  });

  it('lists the seven lines of business and the five things we won’t do', () => {
    render(<AboutUsPage />);

    const lines = within(screen.getByTestId('about-what-we-do'));
    ['E-commerce', 'Custom builds', 'Dealer network', 'Installation points',
      'B2B & showroom supply', 'Government tenders', 'Direct sales']
      .forEach((t) => expect(lines.getByRole('heading', { name: t })).toBeInTheDocument());

    expect(screen.getByText(/don’t sell counterfeit or replica parts/)).toBeInTheDocument();
    expect(screen.getByText(/If a job shouldn’t be done/)).toBeInTheDocument();
  });

  // The deck explicitly routes brands and press elsewhere rather than listing
  // them here — the old page carried a hardcoded brand-logo wall.
  it('defers brands and press to their own pages', () => {
    render(<AboutUsPage />);

    expect(screen.getByRole('link', { name: /brands page/i })).toHaveAttribute('href', '/brands');
    expect(screen.getByRole('link', { name: /media page/i })).toHaveAttribute('href', '/media');
    expect(screen.queryByAltText('Profender')).not.toBeInTheDocument();
  });
});
