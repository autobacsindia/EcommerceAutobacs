/**
 * Backend → frontend revalidation client (services/frontendRevalidator.js).
 * Mocks global fetch; asserts the config gate, prefix allowlist, payload,
 * retry-on-5xx, and no-retry-on-4xx behaviour.
 */

import { jest } from '@jest/globals';

const { revalidateFrontendTags } = await import('../../../services/frontendRevalidator.js');

const OLD_ENV = { ...process.env };
let fetchMock;

beforeEach(() => {
  process.env.FRONTEND_URL = 'https://shop.example.com';
  process.env.REVALIDATE_SECRET = 's3cret';
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  global.fetch = fetchMock;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  jest.restoreAllMocks();
});

it('POSTs allowlisted tags with the secret header', async () => {
  await revalidateFrontendTags(['home:products', 'product:brake-pad']);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, opts] = fetchMock.mock.calls[0];
  expect(url).toBe('https://shop.example.com/api/revalidate');
  expect(opts.method).toBe('POST');
  expect(opts.headers['x-revalidate-secret']).toBe('s3cret');
  expect(JSON.parse(opts.body)).toEqual({ tags: ['home:products', 'product:brake-pad'] });
});

it('drops tags outside the allowlist and skips the call when none remain', async () => {
  await revalidateFrontendTags(['evil:*', 'user:1']);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('is a silent no-op when not configured', async () => {
  delete process.env.REVALIDATE_SECRET;
  await revalidateFrontendTags(['home:products']);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not retry on a 4xx (our own bad request)', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  await revalidateFrontendTags(['home:products']);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('retries on 5xx up to 3 attempts', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 503 });
  await revalidateFrontendTags(['home:products']);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
