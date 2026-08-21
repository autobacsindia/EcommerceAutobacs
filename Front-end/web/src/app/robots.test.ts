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

  it('private routes are disallowed for the wildcard agent too', () => {
    const disallow = ruleFor('*')!.disallow as string[]
    for (const path of ['/admin', '/api/', '/checkout', '/profile', '/festive', '/onam']) {
      expect(disallow).toContain(path)
    }
  })
})
