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

const CDN = 'https://res.cloudinary.com/demo/image/upload/v1/autobacs/promo-banners';

const BANNER: PromoBannerData = {
  id: 'b1',
  imageUrl: `${CDN}/onam-desktop.jpg`,
  imageWidth: 3840,
  imageHeight: 256,
  tabletImageUrl: `${CDN}/onam-tablet.jpg`,
  tabletImageWidth: 2048,
  tabletImageHeight: 256,
  mobileImageUrl: `${CDN}/onam-mobile.jpg`,
  mobileImageWidth: 1280,
  mobileImageHeight: 320,
  alt: 'Onam offer is live',
  linkPath: '/offers',
};

describe('PromoBanner — missing artwork slots', () => {
  /*
    The white-screen regression. Tablet and mobile artwork are optional (the
    admin list only WARNS about a missing file), so a desktop-only banner is a
    legitimate row. It used to reach cloudinaryLoader with `src: undefined`,
    throw `Cannot read properties of undefined (reading 'includes')` mid-render,
    and unwind the tree — taking down every page, because the strip mounts in
    the root layout.
  */
  const desktopOnly: PromoBannerData = {
    ...BANNER,
    tabletImageUrl: null,
    tabletImageWidth: null,
    tabletImageHeight: null,
    mobileImageUrl: null,
    mobileImageWidth: null,
    mobileImageHeight: null,
  };

  it('renders a desktop-only banner without throwing', () => {
    expect(() => render(<PromoBanner banner={desktopOnly} />)).not.toThrow();
    expect(screen.getByAltText('Onam offer is live')).toBeInTheDocument();
  });

  it('falls back to the desktop artwork for the missing tablet and mobile slots', () => {
    const { container } = render(<PromoBanner banner={desktopOnly} />);

    // Every <source> and the bare <img> must point at real artwork — never an
    // "undefined" URL, which would 404 and show a broken image.
    const sources = Array.from(container.querySelectorAll('source'));
    expect(sources).toHaveLength(2);
    sources.forEach((el) => {
      expect(el.getAttribute('srcset')).toContain('onam-desktop.jpg');
      expect(el.getAttribute('srcset')).not.toContain('undefined');
    });

    const img = screen.getByAltText('Onam offer is live');
    expect(img.getAttribute('src')).toContain('onam-desktop.jpg');
    expect(img.getAttribute('src')).not.toContain('undefined');
  });

  it('reserves the fallback file\'s own shape, not the empty slot\'s spec ratio', () => {
    const { container } = render(<PromoBanner banner={desktopOnly} />);
    const link = container.querySelector('a')!;
    // All three breakpoints show the 3840x256 desktop file, so all three boxes
    // must be that shape — otherwise a correctly-supplied banner letterboxes.
    expect(link.getAttribute('style')).toContain('--promo-ar: 3840 / 256');
    expect(link.getAttribute('style')).toContain('--promo-ar-sm: 3840 / 256');
    expect(link.getAttribute('style')).toContain('--promo-ar-lg: 3840 / 256');
  });

  it('renders nothing when the row exists but no artwork has been uploaded', () => {
    const { container } = render(
      <PromoBanner banner={{ ...desktopOnly, imageUrl: null as unknown as string }} />,
    );
    // An empty clickable strip is worse than no strip.
    expect(container).toBeEmptyDOMElement();
  });
});

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

  describe('art direction across breakpoints', () => {
    it('sizes each breakpoint from that slot\'s own artwork ratio', () => {
      render(<PromoBanner banner={BANNER} />);
      // Height follows the file's shape instead of a fixed value, which is what
      // stops the sides being cropped off a strip whose ratio does not happen to
      // match the window's.
      const style = screen.getByRole('link').getAttribute('style') ?? '';
      expect(style).toContain('--promo-ar: 1280 / 320');      // mobile
      expect(style).toContain('--promo-ar-sm: 2048 / 256');   // tablet
      expect(style).toContain('--promo-ar-lg: 3840 / 256');   // desktop
    });

    it('reserves the box before the image loads', () => {
      render(<PromoBanner banner={BANNER} />);
      // A full-width strip at the top of the document is the worst place to take
      // a CLS hit. Fluid height is only safe because the ratio is known upfront
      // from the stored dimensions — the browser reserves the exact box.
      const cls = screen.getByRole('link').className;
      expect(cls).toMatch(/aspect-\[var\(--promo-ar\)\]/);
      expect(cls).toMatch(/sm:aspect-\[var\(--promo-ar-sm\)\]/);
      expect(cls).toMatch(/lg:aspect-\[var\(--promo-ar-lg\)\]/);
    });

    it('falls back to the slot spec ratio when dimensions are unknown', () => {
      // Legacy rows predate dimension capture. Without a fallback the box would
      // collapse to zero height and the banner would silently vanish.
      render(
        <PromoBanner
          banner={{
            ...BANNER,
            imageWidth: null, imageHeight: null,
            tabletImageWidth: null, tabletImageHeight: null,
            mobileImageWidth: null, mobileImageHeight: null,
          }}
        />,
      );
      const style = screen.getByRole('link').getAttribute('style') ?? '';
      expect(style).toContain('--promo-ar: 4 / 1');
      expect(style).toContain('--promo-ar-sm: 8 / 1');
      expect(style).toContain('--promo-ar-lg: 15 / 1');
    });

    it('clamps the height at both ends', () => {
      render(<PromoBanner banner={BANNER} />);
      // Min: a 15:1 desktop file on a 375px phone computes to ~25px — below a
      // usable tap target. Max: a mistakenly square upload would otherwise take
      // over the viewport.
      const cls = screen.getByRole('link').className;
      expect(cls).toMatch(/min-h-\[64px\]/);
      expect(cls).toMatch(/max-h-\[200px\]/);
    });

    it('serves desktop artwork at 1024px and up', () => {
      const { container } = render(<PromoBanner banner={BANNER} />);
      const sources = container.querySelectorAll('source');
      expect(sources[0]).toHaveAttribute('media', '(min-width: 1024px)');
      expect(sources[0].getAttribute('srcset')).toContain('onam-desktop');
    });

    it('serves tablet artwork from 640px', () => {
      const { container } = render(<PromoBanner banner={BANNER} />);
      const sources = container.querySelectorAll('source');
      expect(sources[1]).toHaveAttribute('media', '(min-width: 640px)');
      expect(sources[1].getAttribute('srcset')).toContain('onam-tablet');
    });

    it('orders sources most-specific-first so desktop is not shadowed', () => {
      const { container } = render(<PromoBanner banner={BANNER} />);
      // The browser takes the FIRST matching <source>. If 640px came first, a
      // desktop visitor would get the tablet crop on every page.
      const medias = [...container.querySelectorAll('source')].map((s) => s.getAttribute('media'));
      expect(medias).toEqual(['(min-width: 1024px)', '(min-width: 640px)']);
    });

    it('falls back to mobile artwork in the bare <img>', () => {
      render(<PromoBanner banner={BANNER} />);
      expect(screen.getByAltText('Onam offer is live').getAttribute('src')).toContain('onam-mobile');
    });

    it('downloads exactly one file — never all three', () => {
      const { container } = render(<PromoBanner banner={BANNER} />);
      // Stacked <img>s toggled with `hidden` would make a phone fetch the 3840px
      // desktop file it will never display. <picture> resolves to one.
      expect(container.querySelectorAll('img')).toHaveLength(1);
    });

    it('letterboxes rather than cropping when the box and the file disagree', () => {
      render(<PromoBanner banner={BANNER} />);
      // object-cover would slice the wording off the sides of the offer banner
      // whenever a clamp or a missing dimension changed the box shape. Bars on a
      // matching background are recoverable; a cropped offer is not.
      expect(screen.getByAltText('Onam offer is live').className).toMatch(/object-contain/);
    });

    it('uses the desktop image for every slot when only one was uploaded', () => {
      // The API already substitutes the desktop URL, so a banner with one file
      // still renders everywhere instead of showing a broken image on mobile.
      const single: PromoBannerData = {
        ...BANNER,
        tabletImageUrl: BANNER.imageUrl,
        tabletImageWidth: BANNER.imageWidth,
        tabletImageHeight: BANNER.imageHeight,
        mobileImageUrl: BANNER.imageUrl,
        mobileImageWidth: BANNER.imageWidth,
        mobileImageHeight: BANNER.imageHeight,
      };
      const { container } = render(<PromoBanner banner={single} />);
      const srcsets = [...container.querySelectorAll('source')].map((s) => s.getAttribute('srcset'));
      expect(srcsets.every((s) => s?.includes('onam-desktop'))).toBe(true);
      expect(screen.getByAltText('Onam offer is live').getAttribute('src')).toContain('onam-desktop');
    });

    it('offers renditions up to 3840px so a 2x desktop is not upscaled', () => {
      render(<PromoBanner banner={BANNER} />);
      // A srcset stopping at 1920 is what made the strip look blurry on a
      // 1920px window at 2x device-pixel-ratio.
      expect(screen.getByAltText('Onam offer is live').getAttribute('srcset')).toContain('3840w');
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
