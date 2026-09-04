/**
 * Drift guard: sitemap static routes ↔ Back-end/server/config/staticPages.js.
 *
 * `staticPages.js` is the single source of truth for which entity-less pages
 * exist and is what the admin SEO screen manages. The sitemap kept its own
 * hand-maintained copy, and the two silently drifted: /help and /track were
 * managed but never submitted, while /shop — a redirect — was submitted at
 * priority 0.8. Nothing failed, because neither list knows about the other.
 *
 * Read via fs rather than imported: it is backend ESM outside this app's module
 * graph, and a curated config file is a stable enough shape to parse. If the
 * file moves, this test fails loudly — which is the correct outcome, not a skip.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { STATIC_ROUTES } from './sitemap'

const STATIC_PAGES_CONFIG = resolve(__dirname, '../../../../Back-end/server/config/staticPages.js')

/**
 * Paths intentionally managed for SEO but kept OUT of the sitemap.
 * Every entry needs a reason — an empty list is the expected steady state.
 */
const DELIBERATELY_UNSUBMITTED: Record<string, string> = {}

function managedPaths(): string[] {
  const source = readFileSync(STATIC_PAGES_CONFIG, 'utf8')
  const paths = [...source.matchAll(/^\s*\{\s*path:\s*'([^']+)'/gm)].map((m) => m[1])
  if (paths.length === 0) {
    throw new Error(`Parsed 0 paths from ${STATIC_PAGES_CONFIG} — the config shape changed`)
  }
  return paths
}

describe('sitemap ↔ staticPages.js', () => {
  const submitted = new Set(STATIC_ROUTES.map(([path]) => path))

  it('finds the backend static-page catalogue', () => {
    expect(managedPaths().length).toBeGreaterThan(0)
  })

  it('submits every admin-managed static page', () => {
    const missing = managedPaths().filter(
      (path) => !submitted.has(path) && !(path in DELIBERATELY_UNSUBMITTED),
    )
    expect(missing).toEqual([])
  })

  it('submits no static page the backend does not manage, except listing roots', () => {
    // Listing roots are entity-backed index pages; their SEO comes from the
    // entity system, not the PageSeo collection, so they are correctly absent
    // from staticPages.js.
    const LISTING_ROOTS = ['/products', '/categories', '/brands', '/blog']
    const managed = new Set(managedPaths())
    const unmanaged = [...submitted].filter(
      (path) => !managed.has(path) && !LISTING_ROOTS.includes(path),
    )
    expect(unmanaged).toEqual([])
  })
})
