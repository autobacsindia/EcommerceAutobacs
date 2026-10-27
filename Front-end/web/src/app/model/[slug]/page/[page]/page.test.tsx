/**
 * @jest-environment node
 */

/**
 * /model/[slug]/page/[n] past the vehicle's last page must 404, not answer 200 with
 * an empty listing (a thin page in Search Console). A count that could not be read
 * must NOT 404 — an outage may never turn a real page into a 404.
 */

const notFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
const redirect = jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); });
const permanentRedirect = jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); });
jest.mock('next/navigation', () => ({
  notFound: () => notFound(),
  redirect: (to: string) => redirect(to),
  permanentRedirect: (to: string) => permanentRedirect(to),
}));

const lookupVehicle = jest.fn();
const vehiclePageCount = jest.fn();
jest.mock('@/lib/vehicleMetadata', () => ({
  lookupVehicle: (s: string) => lookupVehicle(s),
  vehiclePageCount: (s: string) => vehiclePageCount(s),
  buildVehicleMetadata: async (slug: string, page: number) => ({ alternates: { canonical: `/model/${slug}/page/${page}` } }),
}));
jest.mock('@/lib/legacyTargetServer', () => ({ resolveLegacyTarget: jest.fn() }));
jest.mock('@/components/vehicles/VehicleModelListing', () => ({ __esModule: true, default: () => null }));

import Page, { generateMetadata } from './page';

const props = (page: string) => ({ params: Promise.resolve({ slug: 'toyota-hilux', page }) });

describe('/model/[slug]/page/[page] range check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lookupVehicle.mockResolvedValue({ status: 'found', vehicle: { name: 'Toyota Hilux' } });
  });

  it('renders a page inside the range', async () => {
    vehiclePageCount.mockResolvedValue(14);
    await expect(Page(props('9'))).resolves.toBeDefined();
    await expect(generateMetadata(props('9'))).resolves.toMatchObject({
      alternates: { canonical: '/model/toyota-hilux/page/9' },
    });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('renders the last page', async () => {
    vehiclePageCount.mockResolvedValue(14);
    await expect(Page(props('14'))).resolves.toBeDefined();
  });

  it('404s one past the last page — page and metadata both', async () => {
    vehiclePageCount.mockResolvedValue(14);
    await expect(Page(props('15'))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(generateMetadata(props('15'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s page 2 of a vehicle with no products', async () => {
    vehiclePageCount.mockResolvedValue(0);
    await expect(Page(props('2'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('does NOT 404 when the count could not be read', async () => {
    vehiclePageCount.mockResolvedValue(null);
    await expect(Page(props('30'))).resolves.toBeDefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('still sends page 1 to the clean URL before anything else', async () => {
    await expect(Page(props('1'))).rejects.toThrow('NEXT_REDIRECT /model/toyota-hilux');
    expect(vehiclePageCount).not.toHaveBeenCalled();
  });
});
