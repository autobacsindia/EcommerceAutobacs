import { render, screen } from '@testing-library/react';
import PromoBanner from './PromoBanner';
import ConditionalPromoBanner from './ConditionalPromoBanner';
import type { PromoBanner as PromoBannerData } from '@/lib/promoBanner';

const mockPathname = jest.fn<string, []>();
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

// The reward-ribbon precedence rule. Mocked here so these tests stay about
// placement; the rule itself is exercised in useRewardRibbon.test.tsx.
const mockRibbonClaimsSlot = jest.fn<boolean, []>();
jest.mock('@/hooks/useRewardRibbon', () => ({
  useRewardRibbonClaimsSlot: () => mockRibbonClaimsSlot(),
}));

const BANNER: PromoBannerData = {
  id: 'b1',
  imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/autobacs/promo-banners/onam.jpg',
  imageWidth: 1600,
  imageHeight: 100,
  alt: 'Onam offer is live',
  linkPath: '/offers',
};

describe('PromoBanner', () => {
  it('renders nothing when no campaign is scheduled', () => {
    const { container } = render(<PromoBanner banner={null} />);
    // The all-year default. It must occupy no space at all, not an empty strip.
    expect(container).toBeEmptyDOMElement();
  });

  it('links to the configured destination and labels the link for screen readers', () => {
    render(<PromoBanner banner={BANNER} />);
    const link = screen.getByRole('link', { name: 'Onam offer is live' });
    expect(link).toHaveAttribute('href', '/offers');
  });

  it('honours a non-default destination', () => {
    render(<PromoBanner banner={{ ...BANNER, linkPath: '/categories/body-kits' }} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/categories/body-kits');
  });

  it('delivers the image through the Cloudinary transform, never the stored original', () => {
    render(<PromoBanner banner={BANNER} />);
    const img = screen.getByAltText('Onam offer is live');
    // f_auto/c_limit is what keeps this from shipping the full-resolution upload
    // to every visitor on every page.
    expect(img.getAttribute('src')).toContain('f_auto');
    expect(img.getAttribute('src')).toContain('c_limit');
    expect(img).toHaveAttribute('srcset');
  });

  it('loads eagerly — a lazy top-of-page image is a guaranteed late paint', () => {
    render(<PromoBanner banner={BANNER} />);
    expect(screen.getByAltText('Onam offer is live')).toHaveAttribute('loading', 'eager');
  });

  describe('proportional scaling', () => {
    it('reserves space from the artwork\'s own aspect ratio', () => {
      render(<PromoBanner banner={BANNER} />);
      // The browser derives the height from the width at first layout, so the
      // strip is full-size in the very first frame. Without this the box is 0px
      // tall until the bytes land — a full-width shift on every page.
      expect(screen.getByRole('link')).toHaveStyle({ aspectRatio: '1600 / 100' });
    });

    it('falls back to the house ratio when dimensions are missing', () => {
      // A hand-seeded row, or one saved before the fields existed, must still
      // reserve space rather than collapsing to nothing.
      render(<PromoBanner banner={{ ...BANNER, imageWidth: null, imageHeight: null }} />);
      expect(screen.getByRole('link')).toHaveStyle({ aspectRatio: '1600 / 100' });
    });

    it('shows the whole image rather than cropping it', () => {
      render(<PromoBanner banner={BANNER} />);
      // object-contain, not object-cover: a crop on a narrow screen would slice
      // the campaign wording off the ends, which is the whole message.
      expect(screen.getByAltText('Onam offer is live').className).toMatch(/object-contain/);
    });

    it('serves one responsive image, not a per-breakpoint set', () => {
      const { container } = render(<PromoBanner banner={BANNER} />);
      // One <img> scaled by the viewport. If a campaign ever needs a distinct
      // mobile crop, that arrives as a <picture> source — deliberately, not by
      // default.
      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(screen.getByAltText('Onam offer is live')).toHaveAttribute('sizes', '100vw');
    });

    it('passes intrinsic dimensions to the img for the browser\'s own ratio maths', () => {
      render(<PromoBanner banner={BANNER} />);
      const img = screen.getByAltText('Onam offer is live');
      expect(img).toHaveAttribute('width', '1600');
      expect(img).toHaveAttribute('height', '100');
    });
  });
});

describe('ConditionalPromoBanner', () => {
  beforeEach(() => mockRibbonClaimsSlot.mockReturnValue(false));

  const renderAt = (path: string, banner: PromoBannerData | null = BANNER) => {
    mockPathname.mockReturnValue(path);
    return render(<ConditionalPromoBanner banner={banner} />);
  };

  it.each(['/products', '/products/some-part', '/categories/audio', '/offers', '/about'])(
    'shows on the storefront route %s',
    (path) => {
      const { container } = renderAt(path);
      expect(container).not.toBeEmptyDOMElement();
    },
  );

  it.each([
    ['/', 'the home page mounts it itself, below the hero'],
    ['/admin', 'internal tooling'],
    ['/admin/orders', 'internal tooling'],
    ['/login', 'minimal auth chrome'],
    ['/register', 'minimal auth chrome'],
  ])('hides on %s (%s)', (path) => {
    const { container } = renderAt(path);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['/cart', '/checkout', '/checkout/payment'])(
    'hides on %s — never advertise a way out of an in-progress purchase',
    (path) => {
      const { container } = renderAt(path);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('still suppresses when the path carries a trailing slash', () => {
    // next.config.ts sets skipTrailingSlashRedirect, so '/cart/' is served
    // verbatim and an exact === '/cart' check would miss it — the same trap
    // ConditionalHeader documents after the double-header bug.
    const { container } = renderAt('/cart/');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on a storefront route when no banner is scheduled', () => {
    const { container } = renderAt('/products', null);
    expect(container).toBeEmptyDOMElement();
  });

  it('stands down when the campaign reward ribbon owns the slot', () => {
    // Two stacked bars push the page down and split attention across two offers.
    // The ribbon wins: it is the only on-screen proof of a discount the customer
    // was personally emailed about.
    mockRibbonClaimsSlot.mockReturnValue(true);
    mockPathname.mockReturnValue('/products');
    const { container } = render(<ConditionalPromoBanner banner={BANNER} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('takes the slot back when no reward ribbon is showing', () => {
    mockRibbonClaimsSlot.mockReturnValue(false);
    mockPathname.mockReturnValue('/products');
    const { container } = render(<ConditionalPromoBanner banner={BANNER} />);
    expect(container).not.toBeEmptyDOMElement();
  });
});
