/**
 * @jest-environment node
 *
 * The 404 page: its own title, never indexed, and it renders even when the
 * category API is down (a 404 page that crashes is a 500).
 */
jest.mock('@/app/HomeClientSection', () => ({ VehicleSelectorSection: () => null }));
jest.mock('@/components/notFound/NotFoundTracker', () => () => null);

import { renderToStaticMarkup } from 'react-dom/server';
import NotFound, { metadata } from './not-found';

describe('not-found page', () => {
  afterEach(() => { (global.fetch as unknown) = undefined; });

  it('has a unique title and noindex', () => {
    expect(metadata.title).toBe('Page not found');
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates).toBeNull(); // no canonical to the home page
  });

  it('renders with no categories when the API fails', async () => {
    global.fetch = jest.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    await expect(NotFound()).resolves.toBeTruthy();
  });

  it('lists top-level categories only', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ categories: [
        { name: 'Winches', slug: 'winches' },
        { name: 'Child', slug: 'child', parent: { slug: 'winches' } },
      ] }),
    })) as unknown as typeof fetch;
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('/categories/winches');
    expect(html).not.toContain('/categories/child');
  });
});
