/**
 * @jest-environment node
 */

/**
 * /model/[slug] metadata and page count.
 *
 * Canonical: every query variant Google holds (?per_page=, ?layout=, ?sort=,
 * ?category=) must point at the clean path. buildVehicleMetadata never sees the
 * query string, and these tests pin that the canonical is path-only.
 */
import { buildVehicleMetadata, vehiclePageCount } from './vehicleMetadata';

const realFetch = global.fetch;
afterAll(() => { global.fetch = realFetch; });

const respond = (status: number, body: unknown) =>
  jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('buildVehicleMetadata canonical', () => {
  beforeEach(() => {
    global.fetch = respond(200, { success: true, vehicle: { name: 'Toyota Hilux' } }) as unknown as typeof fetch;
  });

  it('page 1 → /model/<slug>', async () => {
    const meta = await buildVehicleMetadata('toyota-hilux', 1);
    expect(meta.alternates?.canonical).toBe('/model/toyota-hilux');
  });

  it('deep page self-canonicalises with no query string', async () => {
    const meta = await buildVehicleMetadata('toyota-hilux', 9);
    expect(meta.alternates?.canonical).toBe('/model/toyota-hilux/page/9');
  });
});

describe('vehiclePageCount', () => {
  it.each([
    [166, 14],
    [12, 1],
    [13, 2],
    [0, 0],
  ])('total %i → %i pages of 12', async (total, pages) => {
    global.fetch = respond(200, { success: true, total }) as unknown as typeof fetch;
    // A distinct slug per case: the function is cache()d per argument.
    await expect(vehiclePageCount(`v-${total}`)).resolves.toBe(pages);
  });

  it('asks for one product only, unfiltered', async () => {
    const f = respond(200, { total: 5 });
    global.fetch = f as unknown as typeof fetch;
    await vehiclePageCount('ford-endeavour');
    expect(f.mock.calls[0][0]).toMatch(/\/products\/by-vehicle\/ford-endeavour\?page=1&limit=1$/);
  });

  it.each([
    ['an error status', () => respond(500, {})],
    ['a body without total', () => respond(200, { success: true })],
    ['a network failure', () => jest.fn().mockRejectedValue(new Error('offline'))],
  ])('is null (never a 404) on %s', async (label, make) => {
    global.fetch = make() as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(vehiclePageCount(`fail-${label}`)).resolves.toBeNull();
  });
});
