/**
 * Sitemap contract.
 *
 * Two production failures motivate this file, and both were invisible to the
 * happy path:
 *
 *  1. `generateSitemaps()` moved the output to /sitemap/N.xml and left
 *     /sitemap.xml — the only URL robots.txt advertises — returning 404.
 *  2. The shard dispatcher compared `id === 1` while Next passes `id` as a
 *     STRING, so the article shard re-served the static shard and every blog
 *     post vanished. `id >= 2` kept working because `>=` coerces, so products
 *     looked correct and hid it.
 *
 * The structural fix is a single sitemap with no shard dispatch at all, so the
 * first test here is that `generateSitemaps` is GONE. Reintroducing it without
 * a `<sitemapindex>` route re-breaks /sitemap.xml, and nothing else would say so.
 */

import sitemap, { STATIC_ROUTES } from './sitemap'
import * as sitemapModule from './sitemap'

const BASE = 'http://localhost:3000'

const PRODUCTS = { products: [{ slug: 'led-bar', updatedAt: '2026-08-01T00:00:00.000Z' }] }
const CATEGORIES = { categories: [{ slug: 'lighting', updatedAt: '2026-08-02T00:00:00.000Z' }] }
const BRANDS = { brands: [{ slug: 'auxbeam', updatedAt: '2026-08-03T00:00:00.000Z' }] }
const ARTICLES = { data: [{ slug: 'thar-roxx-accessories', publishedAt: '2026-08-04T00:00:00.000Z' }] }
const VEHICLES = { vehicles: [{ slug: 'mahindra-thar-roxx', updatedAt: '2026-08-05T00:00:00.000Z' }] }

/** Route each upstream path to a canned body; `overrides` can fail one source. */
function mockApi(overrides: Record<string, { ok?: boolean; body?: unknown }> = {}) {
  global.fetch = jest.fn(async (url: string) => {
    const path = String(url)
    const match = (frag: string) => path.includes(frag)

    const pick = (): { ok?: boolean; body?: unknown } => {
      if (match('/products/count')) return overrides.count ?? { body: { total: 1 } }
      if (match('/products/sitemap')) return overrides.products ?? { body: PRODUCTS }
      if (match('/categories/sitemap')) return overrides.categories ?? { body: CATEGORIES }
      if (match('/brands/sitemap')) return overrides.brands ?? { body: BRANDS }
      if (match('/vehicles/sitemap')) return overrides.vehicles ?? { body: VEHICLES }
      if (match('/media/articles/sitemap')) return overrides.articles ?? { body: ARTICLES }
      return { body: {} }
    }

    const { ok = true, body = {} } = pick()
    return { ok, status: ok ? 200 : 500, statusText: ok ? 'OK' : 'Error', json: async () => body }
  }) as unknown as typeof fetch
}

const urls = async () => (await sitemap()).map((e) => e.url)

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockApi()
})

afterEach(() => jest.restoreAllMocks())

describe('sitemap shape', () => {
  it('does NOT export generateSitemaps — that is what 404s /sitemap.xml', () => {
    expect((sitemapModule as Record<string, unknown>).generateSitemaps).toBeUndefined()
  })

  it('takes no shard id — a single sitemap has nothing to dispatch on', () => {
    expect(sitemap.length).toBe(0)
  })
})

describe('sitemap contents', () => {
  it('includes every source, each at its own URL shape', async () => {
    const found = await urls()
    expect(found).toContain(`${BASE}/products/led-bar`)
    expect(found).toContain(`${BASE}/categories/lighting`)
    expect(found).toContain(`${BASE}/brands/auxbeam`)
    expect(found).toContain(`${BASE}/model/mahindra-thar-roxx`)
    // Blog posts live at the site root for WordPress permalink parity (ADR-005).
    expect(found).toContain(`${BASE}/thar-roxx-accessories`)
  })

  it('submits /model/[slug] but NOT the /vehicles browse tree', async () => {
    const found = await urls()
    expect(found).toContain(`${BASE}/model/mahindra-thar-roxx`)
    expect(found.some((u) => u.startsWith(`${BASE}/vehicles`))).toBe(false)
  })

  it('emits the home page without a trailing slash', async () => {
    const found = await urls()
    expect(found).toContain(BASE)
    expect(found).not.toContain(`${BASE}/`)
  })

  it('never submits /shop — it is a redirect competing with /products', async () => {
    const found = await urls()
    expect(found).not.toContain(`${BASE}/shop`)
    expect(found).toContain(`${BASE}/products`)
  })

  it('never submits /about — it redirects to /about-us', async () => {
    const found = await urls()
    expect(found).not.toContain(`${BASE}/about`)
    expect(found).toContain(`${BASE}/about-us`)
  })

  it('has no duplicate URLs', async () => {
    const found = await urls()
    expect(found.length).toBe(new Set(found).size)
  })

  it('gives every entry a valid lastModified', async () => {
    for (const entry of await sitemap()) {
      expect(Number.isNaN(new Date(entry.lastModified as Date).getTime())).toBe(false)
    }
  })

  it('walks every product page, not just the first', async () => {
    mockApi({
      count: { body: { total: 260 } }, // 260 > PRODUCT_PAGE_SIZE (250) ⇒ 2 pages
      products: { body: PRODUCTS },
    })
    await sitemap()
    const paths = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]))
    expect(paths.some((p) => p.includes('page=1'))).toBe(true)
    expect(paths.some((p) => p.includes('page=2'))).toBe(true)
  })
})

describe('upstream failure', () => {
  it('keeps the other sources when one API is down', async () => {
    mockApi({ articles: { ok: false } })
    const found = await urls()
    expect(found).toContain(`${BASE}/products/led-bar`)
    expect(found).toContain(`${BASE}/categories/lighting`)
    expect(found).toContain(`${BASE}/brands/auxbeam`)
    expect(found).toContain(`${BASE}/model/mahindra-thar-roxx`)
    expect(found).not.toContain(`${BASE}/thar-roxx-accessories`)
  })

  it('still emits the static routes when every API is down', async () => {
    mockApi({
      count: { ok: false },
      products: { ok: false },
      categories: { ok: false },
      brands: { ok: false },
      vehicles: { ok: false },
      articles: { ok: false },
    })
    const found = await urls()
    expect(found).toContain(BASE)
    expect(found).toContain(`${BASE}/terms`)
  })

  it('serves the last good product list rather than dropping the section', async () => {
    await sitemap() // warms the per-source cache
    mockApi({ count: { ok: false } })
    const found = await urls()
    expect(found).toContain(`${BASE}/products/led-bar`)
  })
})

describe('static route table', () => {
  it('declares a valid changeFrequency and priority for every route', () => {
    const FREQS = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']
    for (const [path, freq, priority] of STATIC_ROUTES) {
      expect(path.startsWith('/')).toBe(true)
      expect(FREQS).toContain(freq)
      expect(priority).toBeGreaterThan(0)
      expect(priority).toBeLessThanOrEqual(1)
    }
  })

  it('lists each path once', () => {
    const paths = STATIC_ROUTES.map(([p]) => p)
    expect(paths.length).toBe(new Set(paths).size)
  })
})
