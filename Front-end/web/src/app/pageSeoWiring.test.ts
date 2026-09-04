/**
 * Every admin-managed static page must actually RENDER its managed SEO.
 *
 * `config/staticPages.js` lists the pages, `/admin/seo` stores overrides for
 * them, and `buildPageMetadata(path, fallback)` is the only thing that reads
 * either. A page that never calls it silently ignores both: it inherits the
 * root layout's title and ships as "ROAVION - Powered by AutoBacs India".
 *
 * Six pages were in exactly that state in production — /faq, /help, /track,
 * /shipping, /returns, /warranty — all serving one identical title while the
 * admin screen happily saved overrides nothing read. Four of them were also in
 * the sitemap, so Google was being handed four URLs with the same title.
 *
 * Nothing failed, because the config end and the render end don't know about
 * each other. This test is the missing link. Same class as the cache-tag drift
 * guard: a consumer with no producer is dead wiring, and only a cross-check
 * that reads both ends can see it.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'

const APP_DIR = __dirname
const STATIC_PAGES_CONFIG = resolve(__dirname, '../../../../Back-end/server/config/staticPages.js')

/**
 * Paths intentionally NOT wired to buildPageMetadata. Each needs a reason.
 *
 * '/' — the home title is set deliberately in the root layout as
 * `title.default` ("ROAVION - Powered by AutoBacs India"). Routing it through
 * buildPageMetadata would return a plain-string title, which the layout's
 * "%s | Autobacs India" template then appends to — producing the doubled
 * "Autobacs India | Premium Automotive Accessories | Autobacs India". Wiring
 * home is a deliberate SEO decision about the site's most valuable page, not a
 * mechanical fix. Until it's made, /admin/seo cannot manage the home page.
 */
const UNWIRED_BY_DESIGN: Record<string, string> = {
  '/': 'title set deliberately in the root layout; see comment above',
}

function managedPaths(): string[] {
  const source = readFileSync(STATIC_PAGES_CONFIG, 'utf8')
  const paths = [...source.matchAll(/^\s*\{\s*path:\s*'([^']+)'/gm)].map((m) => m[1])
  if (paths.length === 0) {
    throw new Error(`Parsed 0 paths from ${STATIC_PAGES_CONFIG} — the config shape changed`)
  }
  return paths
}

/** Where a route's metadata may legitimately live: its page, or a server layout wrapping it. */
function metadataSources(path: string): string[] {
  const dir = path === '/' ? APP_DIR : join(APP_DIR, path.replace(/^\//, ''))
  return ['page.tsx', 'layout.tsx'].map((f) => join(dir, f)).filter(existsSync)
}

describe('admin-managed pages render their managed SEO', () => {
  const paths = managedPaths().filter((p) => !(p in UNWIRED_BY_DESIGN))

  it('finds the backend catalogue and some wired pages', () => {
    expect(paths.length).toBeGreaterThan(0)
  })

  it.each(paths)('%s has a route on disk', (path) => {
    expect(metadataSources(path).length).toBeGreaterThan(0)
  })

  it.each(paths)('%s calls buildPageMetadata for its own path', (path) => {
    const wiredIn = metadataSources(path).filter((file) => {
      const source = readFileSync(file, 'utf8')
      return source.includes(`buildPageMetadata('${path}'`)
    })
    expect(wiredIn.length).toBeGreaterThan(0)
  })

  it.each(paths)('%s does not leave a client page without a server layout', (path) => {
    const sources = metadataSources(path)
    const page = sources.find((f) => f.endsWith('page.tsx'))
    if (!page) return
    const isClient = readFileSync(page, 'utf8').trimStart().startsWith("'use client'")
    if (!isClient) return
    // A client page cannot export generateMetadata — it needs a sibling layout.
    expect(sources.some((f) => f.endsWith('layout.tsx'))).toBe(true)
  })
})
