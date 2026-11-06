/**
 * The festive home page: shown only while the admin festival theme is live, and
 * never inventing a number — every figure is the catalogue's own.
 */
import { render, screen } from '@testing-library/react';
import { FestivalThemeProvider } from '@/components/festival/FestivalThemeContext';
import type { PublicFestivalTheme } from '@/lib/festival/festivalTheme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CurrencyProvider } from '@/context/CurrencyContext';
import StoreHome, { buildFestiveHero, buildSlides } from './StoreHome';
import { buildGiftTiers, giftBand } from './giftTiers';
import type { StoreHomeData, StoreProduct } from './storeData';

let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/queries/useVehicleMakes', () => ({
  useVehicleMakes: () => ({ data: [] }),
  useVehicleModels: () => ({ data: [], isFetching: false }),
}));
jest.mock('@/components/home/redesign/Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));

const HOUR = 3600_000;
const liveTheme = (): PublicFestivalTheme => ({
  themeKey: 'diwali',
  startsAt: new Date(Date.now() - HOUR).toISOString(),
  endsAt: new Date(Date.now() + HOUR).toISOString(),
  live: true,
});

const prod = (id: string, price: number, originalPrice?: number): StoreProduct => ({
  id, name: `Product ${id}`, href: `/products/${id}`, image: `https://img.example/${id}.jpg`,
  brand: '', price, originalPrice, rating: 0, reviews: 0,
});

const deals = [prod('d1', 1620, 3840), prod('d2', 38250, 85000), prod('d3', 2176, 4352), prod('d4', 9000, 10000)];
const data: StoreHomeData = {
  categories: [{ name: 'Lighting', slug: 'lighting', href: '/categories/lighting', image: '' }],
  deals,
  dealsTotal: 76,
  bestSellers: [prod('b1', 4200), prod('b2', 5499), prod('b3', 19990)],
  newArrivals: [prod('n1', 14850), prod('n2', 59999)],
  featured: [],
  categoryRows: [],
  brands: [],
  reviews: [],
};

function renderHome(theme: PublicFestivalTheme | null, initialLive: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
    <CurrencyProvider>
      <FestivalThemeProvider theme={theme} initialLive={initialLive}>
        <StoreHome data={data} />
      </FestivalThemeProvider>
    </CurrencyProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation((q: string) => ({
    matches: false, media: q, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(),
  }));
});
beforeEach(() => { mockPath = '/'; });

describe('festive home page switch', () => {
  it('festival OFF: the normal banners and shelf titles, nothing festive', () => {
    renderHome(null, false);
    expect(screen.queryByTestId('festive-hero')).not.toBeInTheDocument();
    expect(screen.queryByTestId('festive-gifts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('festive-wish')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Offers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Today's Deals" })).toBeInTheDocument();
  });

  it('festival EXPIRED (cached "on" past its end date): normal page', () => {
    const expired = { ...liveTheme(), endsAt: new Date(Date.now() - 1000).toISOString() };
    renderHome(expired, false);
    expect(screen.queryByTestId('festive-hero')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Today's Deals" })).toBeInTheDocument();
  });

  it('festival LIVE: festive hero replaces the carousel, deals retitled, gifts and wish shown', () => {
    renderHome(liveTheme(), true);
    expect(screen.getByTestId('festive-hero')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Offers' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Diwali Deals' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Today's Deals" })).not.toBeInTheDocument();
    expect(screen.getByTestId('festive-gifts')).toBeInTheDocument();
    expect(screen.getByTestId('festive-wish')).toHaveTextContent('Happy Diwali from Team Roavion');
  });

  it('hero numbers are the real ones: top discount and the deals count', () => {
    renderHome(liveTheme(), true);
    const hero = screen.getByTestId('festive-hero');
    expect(hero).toHaveTextContent('58%'); // 1620 vs 3840
    expect(hero).toHaveTextContent('76');
    expect(hero.querySelectorAll('a[href="/offers"]').length).toBeGreaterThan(0);
  });

  it('gift prices are shown from the catalogue, formatted in rupees', () => {
    renderHome(liveTheme(), true);
    const gifts = screen.getByTestId('festive-gifts');
    expect(gifts).toHaveTextContent('Under ₹5,000');
    expect(gifts).toHaveTextContent('₹1,620');
  });
});

describe('buildFestiveHero', () => {
  it('tags each photo with that product\'s own discount, 0 when not on sale', () => {
    const hero = buildFestiveHero(data, buildSlides(data));
    expect(hero.maxOff).toBe(58);
    expect(hero.photos).toHaveLength(3);
    for (const ph of hero.photos) {
      const p = deals.find((d) => d.href === ph.href)!;
      expect(ph.off).toBe(Math.round((1 - p.price / p.originalPrice!) * 100));
    }
  });

  it('no deals: no discount claim and no product count', () => {
    const none = { ...data, deals: [], dealsTotal: 0 };
    const hero = buildFestiveHero(none, buildSlides(none));
    expect(hero.maxOff).toBe(0);
    expect(hero.dealsTotal).toBe(0);
    expect(hero.photos.every((p) => p.off === 0)).toBe(true);
  });
});

describe('buildGiftTiers', () => {
  it('puts a product priced exactly at a limit in the band above', () => {
    expect(giftBand(4999)).toBe(0);
    expect(giftBand(5000)).toBe(1);
    expect(giftBand(14999)).toBe(1);
    expect(giftBand(15000)).toBe(2);
  });

  it('dedupes across pools, keeps pool order, caps each band', () => {
    const a = prod('a', 1000);
    const tiers = buildGiftTiers([[a, prod('b', 2000), prod('c', 3000)], [a, prod('d', 6000), prod('e', 7000)]], 2);
    expect(tiers.map((t) => t.band)).toEqual([0, 1]);
    expect(tiers[0].products.map((p) => p.id)).toEqual(['a', 'b']);
    expect(tiers[1].products.map((p) => p.id)).toEqual(['d', 'e']);
  });

  it('drops half-empty bands, and the whole section when fewer than two bands fill', () => {
    expect(buildGiftTiers([[prod('a', 1000), prod('b', 2000), prod('c', 20000)]])).toEqual([]);
    expect(buildGiftTiers([])).toEqual([]);
  });

  it('ignores products without a usable price', () => {
    const bad = { ...prod('x', 0) };
    const nan = { ...prod('y', Number.NaN) };
    const tiers = buildGiftTiers([[bad, nan, prod('a', 1000), prod('b', 2000), prod('c', 6000), prod('d', 7000)]]);
    expect(tiers.flatMap((t) => t.products.map((p) => p.id))).toEqual(['a', 'b', 'c', 'd']);
  });
});
