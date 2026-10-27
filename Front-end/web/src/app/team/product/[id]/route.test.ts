/**
 * @jest-environment node
 *
 * /team/product/<id> — resolves a panel's product id to its website page.
 * The backend's public GET /products/:id answers 301 → slug for a live product
 * and 404 for a draft or a deleted one; this route turns that into a redirect
 * or a plain "not on the website" page.
 */
import { NextRequest } from 'next/server';
import { GET } from './route';

const P = 'a'.repeat(24);
const V = 'b'.repeat(24);
const fetchMock = jest.fn();

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch; });
beforeEach(() => fetchMock.mockReset());

const call = (id: string, query = '') =>
  GET(new NextRequest(`https://www.autobacsindia.com/team/product/${id}${query}`), { params: Promise.resolve({ id }) });

const backend = (status: number, location?: string) =>
  fetchMock.mockResolvedValue(new Response(null, { status, headers: location ? { location } : {} }));

it('sends a live product to its page, never cached', async () => {
  backend(301, '/api/v1/products/slug/coilover-kit-thar');
  const res = await call(P);
  expect(res.status).toBe(307);
  expect(res.headers.get('location')).toBe('/products/coilover-kit-thar');
  expect(res.headers.get('cache-control')).toMatch(/no-store/);
  // Asked without following the redirect, so the slug can be read off it.
  expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/api/v1/products/${P}$`)), expect.objectContaining({ redirect: 'manual', cache: 'no-store' }));
});

it('opens the exact variant', async () => {
  backend(301, '/api/v1/products/slug/coilover-kit-thar');
  const res = await call(P, `?variant=${V}`);
  expect(res.headers.get('location')).toBe(`/products/coilover-kit-thar?variant=${V}`);
});

it('ignores a variant that is not an id', async () => {
  backend(301, '/api/v1/products/slug/coilover-kit-thar');
  const res = await call(P, '?variant=https://evil.example');
  expect(res.headers.get('location')).toBe('/products/coilover-kit-thar');
});

it('decodes an encoded slug from the backend', async () => {
  backend(301, '/api/v1/products/slug/seat-cover%E2%80%93black');
  const res = await call(P);
  expect(decodeURI(res.headers.get('location')!)).toBe('/products/seat-cover–black');
});

it.each([
  ['a draft or deleted product (404)', 404],
  ['a live product with no slug (200)', 200],
])('%s → "not on the website"', async (_label, status) => {
  backend(status);
  const res = await call(P);
  expect(res.status).toBe(404);
  expect(await res.text()).toMatch(/not on the website/);
});

it('a redirect somewhere unexpected is not followed', async () => {
  backend(301, 'https://evil.example/products/slug/x/y');
  const res = await call(P);
  expect(res.status).toBe(404);
  expect(res.headers.get('location')).toBeNull();
});

it('a malformed id never reaches the backend', async () => {
  const res = await call('../../admin');
  expect(res.status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('backend down or busy → "try again", not "not on the website"', async () => {
  fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
  const down = await call(P);
  expect(down.status).toBe(503);
  expect(await down.text()).toMatch(/try again/);

  backend(429);
  const busy = await call(P);
  expect(busy.status).toBe(503);
});
