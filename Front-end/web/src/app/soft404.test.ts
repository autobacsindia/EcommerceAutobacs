/**
 * Soft-404 guard.
 *
 * Every missing URL on the storefront used to answer HTTP 200 with not-found
 * HTML. Google indexes junk URLs when the status says 200, and uptime/link
 * checks keyed on status read a dead page as healthy.
 *
 * The cause was NOT a missing notFound() — several routes called it. It was the
 * Suspense boundary a `loading.tsx` creates: Next flushes the shell (and
 * therefore commits the status) before the component below can throw. Measured
 * on this codebase, same build, only that file differing:
 *
 *     with root loading.tsx      /zzz-nope → 200
 *     without root loading.tsx   /zzz-nope → 404
 *
 * That makes the failure mode invisible to normal review: a `loading.tsx`
 * dropped into any ANCESTOR segment silently re-breaks a route that still has a
 * perfectly good notFound() call in it. Hence a structural test rather than a
 * behavioural one — it fails on the file, not on a symptom.
 */

import fs from 'fs'
import path from 'path'

const APP_DIR = path.join(process.cwd(), 'src', 'app')

/**
 * Routes that must answer 404 for an unknown entity, and the file that decides
 * it. A layout is listed where the page itself is a client component (client
 * components cannot call notFound()), so a server layout gates the segment.
 */
const MUST_404: { route: string; file: string }[] = [
  { route: '/[slug]',                  file: '[slug]/page.tsx' },
  { route: '/products/[slug]',         file: 'products/[slug]/page.tsx' },
  { route: '/categories/[slug]',       file: 'categories/[slug]/page.tsx' },
  { route: '/brands/[slug]',           file: 'brands/[slug]/page.tsx' },
  { route: '/model/[slug]',            file: 'model/[slug]/page.tsx' },
  { route: '/model/[slug]/page/[page]', file: 'model/[slug]/page/[page]/page.tsx' },
  { route: '/vehicles/[make]',         file: 'vehicles/[make]/layout.tsx' },
  { route: '/vehicles/[make]/[model]', file: 'vehicles/[make]/[model]/layout.tsx' },
]

/** Every segment from src/app down to (and including) the file's own directory. */
function ancestorSegments(relFile: string): string[] {
  const segments: string[] = ['']
  const parts = path.dirname(relFile).split(path.sep).filter((p) => p !== '.')
  let acc = ''
  for (const part of parts) {
    acc = acc ? path.join(acc, part) : part
    segments.push(acc)
  }
  return segments
}

describe('soft-404 guard', () => {
  describe.each(MUST_404)('$route', ({ file }) => {
    it('still calls notFound()', () => {
      const source = fs.readFileSync(path.join(APP_DIR, file), 'utf8')
      expect(source).toMatch(/notFound\(\)/)
    })

    it('has no loading.tsx in any ancestor segment', () => {
      // A loading.tsx anywhere on this chain re-commits HTTP 200 before
      // notFound() can throw. Report every offender, not just the first.
      const offenders = ancestorSegments(file)
        .map((segment) => path.join(APP_DIR, segment, 'loading.tsx'))
        .filter((candidate) => fs.existsSync(candidate))
        .map((candidate) => path.relative(APP_DIR, candidate))

      expect(offenders).toEqual([])
    })
  })

  it('has no loading.tsx at the app root', () => {
    // Called out separately because the root file breaks EVERY route at once —
    // this is the one that produced the site-wide soft 404.
    expect(fs.existsSync(path.join(APP_DIR, 'loading.tsx'))).toBe(false)
  })

  it('keeps the not-found page that the 404s render', () => {
    expect(fs.existsSync(path.join(APP_DIR, 'not-found.tsx'))).toBe(true)
  })

  it('leaves loading.tsx in place on routes that never 404', () => {
    // The inverse guard: this fix removed four loading.tsx files, and the easy
    // over-correction is to delete the rest too. These segments are auth-gated
    // or static — nothing under them calls notFound() — so their skeletons are
    // pure UX win and must stay.
    for (const segment of ['admin', 'cart', 'checkout', 'orders']) {
      expect(fs.existsSync(path.join(APP_DIR, segment, 'loading.tsx'))).toBe(true)
    }
  })
})
