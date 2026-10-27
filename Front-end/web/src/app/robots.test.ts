/**
 * robots.txt rules — guard for the AdsBot carve-out.
 *
 * AdsBot-Google ignores `User-agent: *` by design, so the `/api/` and `/cart`
 * disallow under the wildcard rule did nothing to it and it crawled the API
 * directly (a single AdsBot IP logged attemptCount 534 against /api/v1/cart).
 * The fix is an explicit, separately-named rule per AdsBot agent.
 *
 * These tests pin BOTH halves of that fix, because each fails silently on its
 * own: dropping the AdsBot rules restores the crawl, and dropping `allow: '/'`
 * from them blocks Google's landing-page check and degrades ad quality.
 */

import robots from './robots'

type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] }

const rules = (): Rule[] => {
  const r = robots().rules
  return Array.isArray(r) ? r : [r]
}

const ruleFor = (agent: string) => rules().find((r) => r.userAgent === agent)

describe('robots.txt', () => {
  it('still has a wildcard rule allowing the storefront', () => {
    const wildcard = ruleFor('*')
    expect(wildcard).toBeDefined()
    expect(wildcard!.allow).toBe('/')
  })

  it.each(['AdsBot-Google', 'AdsBot-Google-Mobile'])(
    '%s has its OWN rule — it ignores User-agent: *',
    (agent) => {
      expect(ruleFor(agent)).toBeDefined()
    },
  )

  it.each(['AdsBot-Google', 'AdsBot-Google-Mobile'])(
    '%s is blocked from /api/ and /cart',
    (agent) => {
      const disallow = ruleFor(agent)!.disallow as string[]
      expect(disallow).toContain('/api/')
      expect(disallow).toContain('/cart')
    },
  )

  // Blocking AdsBot wholesale would make Google report "destination not working"
  // and hurt ad quality — the point is to block the API, not the landing pages.
  it.each(['AdsBot-Google', 'AdsBot-Google-Mobile'])(
    '%s can still reach real landing pages',
    (agent) => {
      expect(ruleFor(agent)!.allow).toBe('/')
    },
  )

  it('every agent shares the identical disallow list', () => {
    const lists = rules().map((r) => JSON.stringify(r.disallow))
    expect(new Set(lists).size).toBe(1)
  })

  // Legacy WooCommerce URLs and internal search results must stay CRAWLABLE. A
  // Disallow hides the middleware's 301 (WooCommerce params) and its
  // `X-Robots-Tag: noindex` (search) from Google, which then keeps the URLs in its
  // index indefinitely — the Search Console state this rule was written to clear.
  it('lets Google crawl legacy WooCommerce params and search, so it sees the 301 / noindex', () => {
    for (const r of rules()) {
      const disallow = r.disallow as string[]
      for (const blocked of disallow) {
        expect(blocked).not.toMatch(/add-to-cart|per_page|layout|remove_item|_wpnonce|search|\?s=/)
      }
    }
    const disallow = ruleFor('*')!.disallow as string[]
    for (const live of ['/products', '/categories', '/model', '/brands', '/blog', '/consultation', '/']) {
      expect(disallow).not.toContain(live)
    }
  })

  it('private routes are disallowed for the wildcard agent too', () => {
    const disallow = ruleFor('*')!.disallow as string[]
    for (const path of ['/admin', '/api/', '/checkout', '/profile', '/festive', '/onam', '/team', '/staff-invite']) {
      expect(disallow).toContain(path)
    }
  })
})
