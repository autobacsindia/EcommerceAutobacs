/**
 * @jest-environment node
 */

/**
 * /consultation is reached with per-product query strings (?item=…, and the old
 * ?ref=pdp&item=… Google still holds). Every variant must canonicalise to the bare
 * /consultation — generateMetadata takes no searchParams, and this pins that.
 */
import { SITE_URL } from '@/lib/siteUrl';
import { generateMetadata } from './layout';

const realFetch = global.fetch;
afterAll(() => { global.fetch = realFetch; });

describe('/consultation metadata', () => {
  beforeEach(() => {
    // No admin override reachable: the page's own fallback must still be complete.
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
  });

  it('canonicalises to /consultation with no query string', async () => {
    const meta = await generateMetadata();
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/consultation`);
  });

  it('is indexable (the variants consolidate into it, not out of the index)', async () => {
    const meta = await generateMetadata();
    expect(meta.robots).toBeUndefined();
  });
});
