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

describe('batching beyond the 20-tag request cap', () => {
  const sentTags = () =>
    fetchMock.mock.calls.flatMap(([, opts]) => JSON.parse(opts.body).tags);

  it('sends every tag across multiple requests instead of truncating at 20', async () => {
    // Regression: the expired-sale sweep reverts up to 500 products and builds a
    // product:<slug> tag for each. Truncating at 20 left ~96% of those PDPs
    // advertising the expired lower price while checkout charged the reverted one.
    const tags = ['home:products', 'product:list', ...Array.from({ length: 98 }, (_, i) => `product:p-${i}`)];
    await revalidateFrontendTags(tags);

    expect(fetchMock).toHaveBeenCalledTimes(5); // 100 tags / 20 per request
    expect(sentTags()).toEqual(tags);
    // No request may exceed the frontend route's own cap, or it silently truncates there.
    for (const [, opts] of fetchMock.mock.calls) {
      expect(JSON.parse(opts.body).tags.length).toBeLessThanOrEqual(20);
    }
  });

  it('keeps coarse collection tags in the FIRST request', async () => {
    const tags = ['home:products', 'product:list', ...Array.from({ length: 400 }, (_, i) => `product:p-${i}`)];
    await revalidateFrontendTags(tags);

    const first = JSON.parse(fetchMock.mock.calls[0][1].body).tags;
    expect(first[0]).toBe('home:products');
    expect(first[1]).toBe('product:list');
  });

  it('caps total fan-out so a huge bulk write cannot flood the frontend', async () => {
    const tags = Array.from({ length: 5000 }, (_, i) => `product:p-${i}`);
    await revalidateFrontendTags(tags);

    // 200-tag ceiling / 20 per request.
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(sentTags()).toHaveLength(200);
  });

  it('still sends one request when under the cap', async () => {
    await revalidateFrontendTags(['home:products', 'product:x']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates before batching', async () => {
    await revalidateFrontendTags(['home:products', 'home:products', 'product:x']);
    expect(sentTags()).toEqual(['home:products', 'product:x']);
  });
});
