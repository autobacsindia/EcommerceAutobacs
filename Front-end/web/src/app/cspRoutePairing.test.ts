/**
 * A nonce CSP must never be served over prerendered HTML.
 *
 * THE FAILURE THIS PREVENTS, which was hit while building this feature:
 * `/cart`, `/orders`, `/profile`, `/wishlist` and `/account/affiliate` were
 * listed in STRICT_CSP_PREFIXES on the assumption that "protected routes are
 * dynamic". They are not — they are client components with no server-side
 * dynamic API, so Next prerendered them happily. Each was then served a CSP
 * naming a per-request nonce that no script in the cached HTML carried, and
 * because 'strict-dynamic' discards the 'self' fallback, EVERY script on those
 * pages was blocked.
 *
 * Nothing catches that on its own: the build passes, the unit tests pass, curl
 * returns 200 with correct-looking headers. Only a browser console shows the
 * page is inert. So the pairing is asserted structurally, against the build's
 * own prerender manifest rather than against anyone's belief about a route.
 *
 * Requires `next build` to have run. Skips (loudly) otherwise rather than
 * passing vacuously.
 */

import fs from 'fs'
import path from 'path'
import { isStrictCspPath } from '@/lib/cspRoutes'

const MANIFEST = path.join(process.cwd(), '.next', 'prerender-manifest.json')

const readPrerenderedRoutes = (): string[] | null => {
  if (!fs.existsSync(MANIFEST)) return null
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  return Object.keys(manifest.routes ?? {})
}

/**
 * The manifest only exists after `next build`.
 *
 * CI runs unit tests in a separate, fresh-checkout job BEFORE the build job, so
 * there is no .next there and these checks cannot run. They are wired into the
 * build job instead (.github/workflows/ci-frontend.yml runs this file with
 * REQUIRE_BUILD_MANIFEST=1 straight after `npm run build`) — which is also the
 * only place the manifest is guaranteed CURRENT. Locally it may be stale, so a
 * green run here is weaker evidence than the CI one.
 *
 * REQUIRE_BUILD_MANIFEST=1 turns a missing manifest into a FAILURE, so the
 * build-job invocation can never quietly degrade into a skip.
 */
const routes = readPrerenderedRoutes()
const manifestRequired = process.env.REQUIRE_BUILD_MANIFEST === '1'
const hasManifest = routes !== null

describe('CSP / render-mode pairing', () => {
  it('has a build to check against when one is required', () => {
    if (!manifestRequired && !hasManifest) {
      console.warn(
        '[cspRoutePairing] no .next/prerender-manifest.json — manifest checks ' +
        'skipped. CI runs these after `npm run build` with REQUIRE_BUILD_MANIFEST=1.',
      )
      return
    }
    expect(routes).not.toBeNull()
  })

  it('has actually prerendered something (guards the guard)', () => {
    if (!hasManifest) return
    // If prerendering silently stopped working, the pairing check below would
    // pass trivially while the whole ISR change had regressed.
    expect(routes!.length).toBeGreaterThan(20)
  })

  it.each(routes ?? ['<no manifest — skipped>'])(
    'prerendered route %s is NOT on the strict-CSP list',
    (route) => {
      if (!hasManifest) return
      expect(`${route}:${isStrictCspPath(route)}`).toBe(`${route}:false`)
    },
  )
})

describe('isStrictCspPath', () => {
  it('matches a strict prefix and its descendants', () => {
    expect(isStrictCspPath('/checkout')).toBe(true)
    expect(isStrictCspPath('/checkout/payment')).toBe(true)
    expect(isStrictCspPath('/admin/orders/123')).toBe(true)
  })

  it('does not match a path that merely starts with the same characters', () => {
    // '/checkout-guide' is a public marketing URL, not the checkout flow.
    expect(isStrictCspPath('/checkout-guide')).toBe(false)
    expect(isStrictCspPath('/administrator')).toBe(false)
  })

  it('leaves the public storefront public', () => {
    for (const p of ['/', '/products', '/products/some-slug', '/categories', '/brands', '/privacy']) {
      expect(`${p}:${isStrictCspPath(p)}`).toBe(`${p}:false`)
    }
  })

  it('keeps /login and /register public — they prerender', () => {
    // Deliberate and counter-intuitive: they are auth screens, but they are
    // statically rendered, so a nonce CSP would black them out entirely.
    expect(isStrictCspPath('/login')).toBe(false)
    expect(isStrictCspPath('/register')).toBe(false)
  })
})
