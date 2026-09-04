/**
 * Pagination crawlability guard for the vehicle model listing.
 *
 * Pagination used to be `<button onClick={() => router.push(...)}>`. It worked
 * for a human and was invisible to a crawler: a button carries no href, and no
 * `/model/<slug>/page/N` URL is in sitemap.xml either, so pages 2..n of every
 * model listing had no crawl path at all. Google knew
 * /model/toyota-fortuner/page/3 only as a leftover WordPress URL — which is how
 * it ended up in a tag-coverage report as an orphan.
 *
 * These assert the href VALUES, not merely that anchors exist: the page-1 link
 * must collapse to the canonical /model/<slug> (not /page/1), and filters must
 * survive pagination or every paged URL points at an unfiltered result set.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import VehicleModelListing from './VehicleModelListing';
import { vehicleService } from '@/services/vehicleService';

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearch,
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ categories: [] })) },
}));

jest.mock('@/services/vehicleService', () => ({
  __esModule: true,
  VEHICLE_IMAGE_MAP: {},
  CROSS_RELATED_SLUG_MAP: {},
  vehicleService: { getVehicleProducts: jest.fn() },
}));

jest.mock('@/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: jest.fn() }),
}));

jest.mock('@/hooks/queries/useCampaignProductRates', () => ({
  useCampaignProductRates: () => ({ data: null }),
}));

jest.mock('@/hooks/queries/useCampaign', () => ({
  useCampaignBadgeVisible: () => false,
}));

jest.mock('@/components/products/redesign/StoreProductCard', () => ({
  __esModule: true,
  default: ({ product }: { product: { _id?: string } }) => <div data-testid="card">{product?._id}</div>,
}));

/** 78 products / 12 per page = 7 pages, so page 3 has neighbours on both sides. */
const TOTAL = 78;
const products = Array.from({ length: 12 }, (_, i) => ({
  _id: `p${i}`,
  name: `Product ${i}`,
  price: 1000,
  slug: `product-${i}`,
  images: [],
}));

const getVehicleProducts = vehicleService.getVehicleProducts as jest.Mock;

/** The pagination nav, once the client-side fetch has resolved. */
async function renderAt(pageNumber: number) {
  render(<VehicleModelListing slug="toyota-fortuner" pageNumber={pageNumber} />);
  return waitFor(() => screen.getByRole('navigation', { name: 'Pagination' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  getVehicleProducts.mockResolvedValue({ products, total: TOTAL });
});

describe('vehicle model listing pagination', () => {
  it('renders every page in the window as a crawlable <a href>', async () => {
    const nav = await renderAt(3);
    const links = within(nav).getAllByRole('link');

    // Previous + 1..5 + Next
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/model/toyota-fortuner/page/2',
      '/model/toyota-fortuner',
      '/model/toyota-fortuner/page/2',
      '/model/toyota-fortuner/page/3',
      '/model/toyota-fortuner/page/4',
      '/model/toyota-fortuner/page/5',
      '/model/toyota-fortuner/page/4',
    ]);
  });

  it('points page 1 at the canonical /model/<slug>, never /page/1', async () => {
    const nav = await renderAt(3);
    expect(within(nav).getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/model/toyota-fortuner'
    );
    expect(nav.innerHTML).not.toContain('/page/1');
  });

  it('marks the current page and still gives it an href', async () => {
    const nav = await renderAt(3);
    const current = within(nav).getByRole('link', { name: '3' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('href', '/model/toyota-fortuner/page/3');
  });

  it('carries the active filter and sort into every paged URL', async () => {
    mockSearch = new URLSearchParams('sort=price_asc&category=body-kits');
    const nav = await renderAt(3);
    expect(within(nav).getByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      '/model/toyota-fortuner/page/4?sort=price_asc&category=body-kits'
    );
  });

  it('renders the out-of-range ends as non-links, not dead hrefs', async () => {
    const nav = await renderAt(1);
    expect(within(nav).queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(within(nav).getByText('Previous')).toHaveAttribute('aria-disabled', 'true');
    expect(within(nav).getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/model/toyota-fortuner/page/2'
    );
  });

  it('omits pagination entirely when there is only one page', async () => {
    getVehicleProducts.mockResolvedValue({ products: products.slice(0, 5), total: 5 });
    render(<VehicleModelListing slug="toyota-fortuner" pageNumber={1} />);
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(5));
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });
});
