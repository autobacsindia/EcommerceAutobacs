/**
 * Cloudflare edge purge.
 *
 * The failure this guards against is a purge that REPORTS success while
 * purging nothing: a URL that does not match the cached URL byte-for-byte is
 * accepted by Cloudflare's API and silently has no effect. So the assertions
 * are about the exact request body, not about "did it resolve".
 */

import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

const loadModule = async () => {
  jest.resetModules();
  return import('../../../services/cdnPurgeService.js');
};

const configure = () => {
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  process.env.CLOUDFLARE_ZONE_ID = 'test-zone';
  process.env.PUBLIC_API_URL = 'https://api.autobacsindia.com';
};

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ZONE_ID;
  delete process.env.PUBLIC_API_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

describe('configuration gate', () => {
  it('is a no-op when Cloudflare credentials are absent', async () => {
    process.env.PUBLIC_API_URL = 'https://api.autobacsindia.com';
    const { purgeEdgePaths, isConfigured } = await loadModule();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    expect(isConfigured()).toBe(false);
    await expect(purgeEdgePaths(['/vehicles/makes'])).resolves.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when PUBLIC_API_URL is absent, even with credentials', async () => {
    // Without the origin there is no absolute URL to purge, and guessing one
    // (e.g. the *.railway.app host) would purge a URL nothing is cached under.
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ZONE_ID = 'test-zone';
    const { purgeEdgePaths, isConfigured } = await loadModule();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    expect(isConfigured()).toBe(false);
    await expect(purgeEdgePaths(['/vehicles/makes'])).resolves.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not call the API for an empty path list', async () => {
    configure();
    const { purgeEdgePaths } = await loadModule();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(purgeEdgePaths([])).resolves.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('URL construction', () => {
  it('builds absolute /api/v1 URLs against the public origin', async () => {
    configure();
    const { toAbsoluteUrls } = await loadModule();
    expect(toAbsoluteUrls(['/vehicles/makes', '/reviews/testimonials'])).toEqual([
      'https://api.autobacsindia.com/api/v1/vehicles/makes',
      'https://api.autobacsindia.com/api/v1/reviews/testimonials',
    ]);
  });

  it('tolerates a trailing slash on the configured origin', async () => {
    configure();
    process.env.PUBLIC_API_URL = 'https://api.autobacsindia.com/';
    const { toAbsoluteUrls } = await loadModule();
    // A double slash would be a different URL to Cloudflare, so it would purge
    // nothing while still succeeding.
    expect(toAbsoluteUrls(['/vehicles/makes'])).toEqual([
      'https://api.autobacsindia.com/api/v1/vehicles/makes',
    ]);
  });

  it('drops anything that is not an API-relative path', async () => {
    configure();
    const { toAbsoluteUrls } = await loadModule();
    expect(toAbsoluteUrls(['vehicles/makes', '', null, undefined, 42])).toEqual([]);
  });
});

describe('purgeEdgePaths', () => {
  it('sends the exact absolute URLs as a files[] purge', async () => {
    configure();
    const { purgeEdgePaths } = await loadModule();
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    await expect(purgeEdgePaths(['/vehicles/makes'])).resolves.toBe(1);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/test-zone/purge_cache');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body)).toEqual({
      files: ['https://api.autobacsindia.com/api/v1/vehicles/makes'],
    });
    // purge_everything would dump the year-cached img.<domain> assets too.
    expect(JSON.parse(init.body).purge_everything).toBeUndefined();
  });

  it('batches at 30 URLs — Cloudflare rejects more in one request', async () => {
    configure();
    const { purgeEdgePaths, MAX_URLS_PER_REQUEST } = await loadModule();
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    const paths = Array.from({ length: 31 }, (_, i) => `/p${i}`);
    await expect(purgeEdgePaths(paths)).resolves.toBe(31);

    expect(MAX_URLS_PER_REQUEST).toBe(30);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).files).toHaveLength(30);
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).files).toHaveLength(1);
  });

  it('never throws when Cloudflare returns an application-level error', async () => {
    // success:false arrives with HTTP 200. Treating only !res.ok as failure
    // would report a purge that never happened.
    configure();
    const { purgeEdgePaths } = await loadModule();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, errors: [{ message: 'Invalid zone' }] }),
    });

    await expect(purgeEdgePaths(['/vehicles/makes'])).resolves.toBe(0);
  });

  it('never throws when the network fails — a write must not fail on a CDN blip', async () => {
    configure();
    const { purgeEdgePaths } = await loadModule();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));

    await expect(purgeEdgePaths(['/vehicles/makes'])).resolves.toBe(0);
  });

  it('keeps purging later batches after one batch fails', async () => {
    configure();
    const { purgeEdgePaths } = await loadModule();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    const paths = Array.from({ length: 31 }, (_, i) => `/p${i}`);
    // First batch (30) fails, second (1) succeeds.
    await expect(purgeEdgePaths(paths)).resolves.toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
