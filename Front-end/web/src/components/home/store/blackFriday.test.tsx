/**
 * Black Friday ("neon" festival style): shown only while the admin festival theme
 * is Black Friday and live; every number is the catalogue's own; switching it off
 * (or the end date passing) gives back the normal site with nothing left behind.
 */
import { act, render, screen, within } from '@testing-library/react';
import { FestivalThemeProvider, useFestivalOfferLabel } from '@/components/festival/FestivalThemeContext';
import FestiveToran from '@/components/festival/FestiveToran';
import FestivalOfferTag from '@/components/festival/FestivalOfferTag';
import type { PublicFestivalTheme } from '@/lib/festival/festivalTheme';
import { FESTIVAL_THEMES } from '@/lib/festival/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CurrencyProvider } from '@/context/CurrencyContext';
import StoreHome, { buildFestiveHero, buildSlides } from './StoreHome';
import type { StoreHomeData, StoreProduct } from './storeData';

let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/queries/useVehicleMakes', () => ({
  useVehicleMakes: () => ({ data: [] }),
  useVehicleModels: () => ({ data: [], isFetching: false }),
}));
jest.mock('@/components/home/redesign/Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));

const HOUR = 3600_000;
const theme = (themeKey: string, over: Partial<PublicFestivalTheme> = {}): PublicFestivalTheme => ({
  themeKey,
  startsAt: new Date(Date.now() - HOUR).toISOString(),
  endsAt: new Date(Date.now() + 50 * HOUR).toISOString(),
  live: true,
  ...over,
});

const prod = (id: string, price: number, originalPrice?: number): StoreProduct => ({
  id, name: `Product ${id}`, href: `/products/${id}`, image: `https://img.example/${id}.jpg`,
  brand: '', price, originalPrice, rating: 0, reviews: 0, stock: 'in',
});

const baseData: StoreHomeData = {
  categories: [{ name: 'Lighting', slug: 'lighting', href: '/categories/lighting', image: '' }],
  deals: [prod('d1', 1620, 3840), prod('d2', 38250, 85000), prod('d3', 2176, 4352)],
  dealsTotal: 76,
  productTotal: 953,
  bestSellers: [prod('b1', 4200), prod('b2', 5499)],
  newArrivals: [prod('n1', 14850)],
  featured: [],
  premiumPicks: [],
  categoryRows: [],
  brands: [],
  reviews: [],
};

const wrap = (t: PublicFestivalTheme | null, initialLive: boolean, ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <CurrencyProvider>
      <FestivalThemeProvider theme={t} initialLive={initialLive}>{ui}</FestivalThemeProvider>
    </CurrencyProvider>
  </QueryClientProvider>
);
/** `freeDelivery` = the server says checkout waives the fees (lib/festival/freeDelivery.ts). */
const renderHome = (t: PublicFestivalTheme | null, initialLive: boolean, data = baseData, freeDelivery = false) =>
  render(wrap(t, initialLive, <StoreHome data={data} freeDelivery={freeDelivery} />));

beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation((q: string) => ({
    matches: false, media: q, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(),
  }));
});
beforeEach(() => { mockPath = '/'; });
afterEach(() => { jest.useRealTimers(); });

describe('Black Friday theme tokens', () => {
  it('is a registered neon theme whose words never hard-code a percentage', () => {
    const bf = FESTIVAL_THEMES.blackfriday;
    expect(bf).toBeDefined();
    expect(bf.style).toBe('neon');
    const words = JSON.stringify({ copy: bf.copy, home: bf.home, ticker: bf.ticker, seal: bf.freeDeliverySeal });
    expect(words).not.toMatch(/\d+\s*%/);
  });
  it('Diwali keeps its own style and has no free-delivery seal', () => {
    expect(FESTIVAL_THEMES.diwali.style).toBe('diwali');
    expect(FESTIVAL_THEMES.diwali.freeDeliverySeal).toBeUndefined();
  });
});

describe('Black Friday home page', () => {
  it('live: the neon hero with the REAL top saving, the seal and the offer cards', () => {
    const { maxOff } = buildFestiveHero(baseData, buildSlides(baseData));
    expect(maxOff).toBeGreaterThan(0);
    renderHome(theme('blackfriday'), true, baseData, true);

    const hero = screen.getByTestId('festive-hero');
    expect(hero).toHaveAttribute('data-fx-style', 'neon');
    expect(within(hero).getByRole('heading', { name: /Black\s*Friday\s*Blowout/i })).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: `Up to ${maxOff}% off — shop the deals` })).toHaveAttribute('href', '/offers');
    expect(within(hero).getByTestId('free-delivery-seal')).toHaveTextContent(/Without.*Shipping, packing, delivery.*charges/i);
    expect(within(hero).getByRole('link', { name: /Shop Black Friday Deals/ })).toHaveAttribute('href', '/offers');

    const offers = screen.getByTestId('festive-offers');
    expect(offers).toHaveTextContent(`Up to ${maxOff}% off`);
    expect(offers).toHaveTextContent('76 products on sale');
    expect(screen.getByRole('heading', { name: 'Black Friday Deals' })).toBeInTheDocument();
    // The Diwali artwork is not drawn.
    expect(document.querySelector('.fxh-lantern, .fxh-diya')).toBeNull();
  });

  it('free-delivery seal ONLY when the server says checkout waives the fees', () => {
    {
      const { unmount } = renderHome(theme('blackfriday'), true, baseData, false);
      expect(screen.queryByTestId('free-delivery-seal')).not.toBeInTheDocument();
      expect(screen.getByTestId('festive-offers')).not.toHaveTextContent(/Shipping, packing, delivery/i);
      unmount();
    }
    renderHome(theme('blackfriday'), true, baseData, true);
    expect(screen.getByTestId('free-delivery-seal')).toBeInTheDocument();
    expect(screen.getByTestId('festive-offers')).toHaveTextContent(/Shipping, packing, delivery/i);
  });

  it('free delivery live: the stat covers the whole catalogue with the real count and ₹0 delivery fees', () => {
    renderHome(theme('blackfriday'), true, baseData, true);
    const stats = screen.getByTestId('festive-hero').querySelector('.bfh-stats')!;
    expect(stats).toHaveTextContent('953');
    expect(stats).toHaveTextContent('products · ₹0 delivery fees');
    expect(stats).not.toHaveTextContent('on sale');
    expect(stats).toHaveTextContent(/category\s*1/);
  });

  it('free delivery NOT live, or the count unknown: back to "N products on sale"', () => {
    for (const [data, free] of [[baseData, false], [{ ...baseData, productTotal: 0 }, true]] as const) {
      const { unmount } = renderHome(theme('blackfriday'), true, data, free);
      const stats = screen.getByTestId('festive-hero').querySelector('.bfh-stats')!;
      expect(stats).toHaveTextContent('76');
      expect(stats).toHaveTextContent('products on sale');
      expect(stats).not.toHaveTextContent('₹0 delivery');
      unmount();
    }
  });

  it('no discount anywhere: no "Up to 0%" tag and no red offer card', () => {
    const noDeals: StoreHomeData = { ...baseData, deals: [], dealsTotal: 0 };
    renderHome(theme('blackfriday'), true, noDeals);
    expect(screen.queryByRole('link', { name: /Up to \d+% off/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('festive-offers')).not.toHaveTextContent(/Up to/);
    expect(document.body.textContent).not.toMatch(/0%/);
  });

  it('countdown: blank boxes first (no hydration mismatch), real time after mount, fixed four boxes', () => {
    jest.useFakeTimers();
    const endsAt = new Date(Date.now() + 2 * 86400_000 + 3 * HOUR + 4 * 60_000 + 5_000).toISOString();
    renderHome(theme('blackfriday', { endsAt }), true);
    const timer = screen.getByTestId('hero-countdown');
    expect(within(timer).getAllByRole('listitem')).toHaveLength(4);
    expect(timer).toHaveTextContent(/02\s*Days\s*03\s*Hours\s*04\s*Min\s*0[45]\s*Sec/);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(timer).toHaveTextContent(/0[34]\s*Sec/);
  });

  it('no end date: no countdown at all', () => {
    renderHome(theme('blackfriday', { endsAt: null }), true);
    expect(screen.queryByTestId('hero-countdown')).not.toBeInTheDocument();
  });

  it('Diwali live: the lantern hero, no seal, no Black Friday offer cards', () => {
    renderHome(theme('diwali'), true, baseData, true);
    expect(screen.getByTestId('festive-hero')).not.toHaveAttribute('data-fx-style', 'neon');
    expect(screen.queryByTestId('free-delivery-seal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('festive-offers')).not.toBeInTheDocument();
  });

  it('switched off or ended: the normal home page, nothing Black Friday left', () => {
    const ended = theme('blackfriday', { endsAt: new Date(Date.now() - 1000).toISOString() });
    for (const [t, live] of [[null, false], [ended, false]] as const) {
      const { unmount } = renderHome(t, live);
      expect(screen.queryByTestId('festive-hero')).not.toBeInTheDocument();
      expect(screen.queryByTestId('festive-offers')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: "Today's Deals" })).toBeInTheDocument();
      expect(document.documentElement.dataset.festivalStyle).toBeUndefined();
      unmount();
    }
  });

  it('turns itself off at the end time on the visitor clock, and removes the page-wide style', () => {
    jest.useFakeTimers();
    const endsAt = new Date(Date.now() + 2000).toISOString();
    renderHome(theme('blackfriday', { endsAt }), true);
    expect(screen.getByTestId('festive-hero')).toBeInTheDocument();
    expect(document.documentElement.dataset.festivalStyle).toBe('neon');
    act(() => { jest.advanceTimersByTime(2100); });
    expect(screen.queryByTestId('festive-hero')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.festival).toBeUndefined();
    expect(document.documentElement.dataset.festivalStyle).toBeUndefined();
  });
});

describe('Black Friday top strip', () => {
  it('Black Friday: the neon ticker, decorative only', () => {
    render(wrap(theme('blackfriday'), true, <FestiveToran />));
    const strip = screen.getByTestId('festive-toran');
    expect(strip).toHaveClass('fx-ticker');
    expect(strip).toHaveAttribute('aria-hidden', 'true');
    expect(strip).toHaveTextContent('Black Friday Blowout');
  });
  it('Diwali: still the toran', () => {
    render(wrap(theme('diwali'), true, <FestiveToran />));
    expect(screen.getByTestId('festive-toran')).toHaveClass('fx-toran');
  });
  it('never on checkout', () => {
    mockPath = '/checkout';
    render(wrap(theme('blackfriday'), true, <FestiveToran />));
    expect(screen.queryByTestId('festive-toran')).not.toBeInTheDocument();
  });
});

describe('price-offer label follows the running festival', () => {
  function Label() {
    const l = useFestivalOfferLabel();
    return <span data-testid="label">{`${l.icon}|${l.name}|${l.before}`}</span>;
  }
  it('Black Friday names the offer on every route, checkout included', () => {
    mockPath = '/checkout';
    render(wrap(theme('blackfriday'), true, <Label />));
    expect(screen.getByTestId('label')).toHaveTextContent('Black Friday offer|Before Black Friday');
  });
  it('no festival running: the Diwali words, as before', () => {
    render(wrap(null, false, <Label />));
    expect(screen.getByTestId('label')).toHaveTextContent('Diwali offer|Before Diwali');
  });
  it('the offer tag shows the server figures under the Black Friday name', () => {
    render(wrap(theme('blackfriday'), true, (
      <FestivalOfferTag offer={{ percent: 3, discount: 30, basePrice: 1000 }} formatMoney={(n) => `₹${n.toFixed(2)}`} />
    )));
    const tag = screen.getByTestId('festival-offer-tag');
    expect(tag).toHaveTextContent('Black Friday offer −3%');
    expect(tag).toHaveTextContent('Before Black Friday ₹1000.00');
    expect(tag).not.toHaveTextContent('Diwali');
  });
});
