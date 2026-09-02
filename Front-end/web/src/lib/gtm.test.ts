/**
 * The gate is what stops a placeholder/typo'd container id from reaching an
 * inline <script> in the root layout. Both failure directions are silent in the
 * browser — a bad id 404s inside gtm.js and a quote in the id would break out of
 * the snippet — so the shape check is asserted directly.
 */

async function loadGtm(gtmId: string | undefined) {
  jest.resetModules();
  if (gtmId === undefined) delete process.env.NEXT_PUBLIC_GTM_ID;
  else process.env.NEXT_PUBLIC_GTM_ID = gtmId;
  return import('./gtm');
}

const originalGtmId = process.env.NEXT_PUBLIC_GTM_ID;

describe('lib/gtm', () => {
  afterEach(() => {
    if (originalGtmId === undefined) delete process.env.NEXT_PUBLIC_GTM_ID;
    else process.env.NEXT_PUBLIC_GTM_ID = originalGtmId;
  });

  it('enables the container for a real id and exposes it trimmed', async () => {
    const { GTM_ID, isGtmEnabled } = await loadGtm('  GTM-PK3BVQR9  ');
    expect(GTM_ID).toBe('GTM-PK3BVQR9');
    expect(isGtmEnabled).toBe(true);
  });

  it('stays disabled when the id is unset or blank', async () => {
    expect((await loadGtm(undefined)).isGtmEnabled).toBe(false);
    expect((await loadGtm('')).isGtmEnabled).toBe(false);
    expect((await loadGtm('   ')).isGtmEnabled).toBe(false);
  });

  it('rejects ids that are not a GTM container', async () => {
    // AW-/G-/UA- ids are loaded by their own tags, never by this loader.
    expect((await loadGtm('AW-11434499615')).isGtmEnabled).toBe(false);
    expect((await loadGtm('G-ABC123')).isGtmEnabled).toBe(false);
    expect((await loadGtm('GTM-')).isGtmEnabled).toBe(false);
    expect((await loadGtm('gtm-pk3bvqr9')).isGtmEnabled).toBe(false);
  });

  it('rejects an id carrying script-injection characters', async () => {
    // The id is interpolated into an inline <script> in app/layout.tsx.
    expect((await loadGtm("GTM-X');alert(1);//")).isGtmEnabled).toBe(false);
    expect((await loadGtm('GTM-X</script>')).isGtmEnabled).toBe(false);
  });

  it('keeps GTM off the default dataLayer', async () => {
    // The isolation that stops gtm.js replaying gtag's `config AW-…`, which
    // measured 3x the page_view beacons. Reverting this name is silent: the
    // site keeps working and only the Ads page_view count inflates.
    const { GTM_DATA_LAYER } = await loadGtm('GTM-PK3BVQR9');
    expect(GTM_DATA_LAYER).not.toBe('dataLayer');
    expect(GTM_DATA_LAYER).toBe('gtmDataLayer');
  });

  describe('pushToGtm', () => {
    afterEach(() => {
      delete (window as unknown as Record<string, unknown>).gtmDataLayer;
      delete (window as unknown as Record<string, unknown>).dataLayer;
    });

    it('queues into GTM\'s array, creating it if the container has not loaded', async () => {
      const { pushToGtm, GTM_DATA_LAYER } = await loadGtm('GTM-PK3BVQR9');
      expect(pushToGtm({ event: 'test_event' })).toBe(true);
      expect((window as unknown as Record<string, unknown[]>)[GTM_DATA_LAYER]).toEqual([
        { event: 'test_event' },
      ]);
    });

    it('never touches the gtag dataLayer', async () => {
      const { pushToGtm } = await loadGtm('GTM-PK3BVQR9');
      (window as unknown as Record<string, unknown[]>).dataLayer = [];
      pushToGtm({ event: 'test_event' });
      expect((window as unknown as Record<string, unknown[]>).dataLayer).toEqual([]);
    });

    it('is a no-op when GTM is disabled', async () => {
      const { pushToGtm } = await loadGtm(undefined);
      expect(pushToGtm({ event: 'test_event' })).toBe(false);
      expect((window as unknown as Record<string, unknown>).gtmDataLayer).toBeUndefined();
    });
  });
});
