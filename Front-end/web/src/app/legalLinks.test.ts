/**
 * Legal-link drift guard.
 *
 * The storefront shipped TWO live terms pages. `/terms` was the real one (20
 * sections, in the sitemap, admin-SEO-managed); `/conditions` was a 66-line
 * legacy stub that nothing linked to except the login and register page
 * footers — while those same two pages linked to `/terms` from their body copy.
 * So a shopper could read two different contracts one click apart, and the two
 * disagreed on substance: `/conditions` said prices were inclusive of tax,
 * `/terms` §6 said they were not. (The pricing engine says inclusive —
 * services/pricingService.js embeds GST in the price — so `/terms` was the
 * wrong one and has been corrected.)
 *
 * The same document also carried three different NAMES: "Conditions of Use" on
 * the auth pages, "Terms of Service" in the legacy footer, "Terms and
 * Conditions" as its own <h1>. `/privacy` had two: "Privacy Notice" and
 * "Privacy Policy".
 *
 * None of that is catchable by a rendering test — every page rendered fine. It
 * is a consistency property across files, so it gets a structural test, the same
 * reasoning as soft404.test.ts.
 */

import fs from 'fs'
import path from 'path'

const SRC_DIR = path.join(process.cwd(), 'src')
const NEXT_CONFIG = path.join(process.cwd(), 'next.config.ts')
const STATIC_PAGES = path.join(
  process.cwd(), '..', '..', 'Back-end', 'server', 'config', 'staticPages.js'
)

/** Every .ts/.tsx under src/, excluding this file. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name) && full !== __filename) acc.push(full)
  }
  return acc
}

/**
 * Strip comments so an explanatory note ABOUT the old names (there are several,
 * including in this file's neighbours) doesn't trip the scan. The `(?<!:)`
 * keeps `https://` intact — otherwise every line carrying a URL would be
 * truncated and could hide a real occurrence sitting after it.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '')

const files = sourceFiles(SRC_DIR).map((f) => ({
  rel: path.relative(process.cwd(), f),
  code: stripComments(fs.readFileSync(f, 'utf8')),
}))

describe('legal links: one document, one name, one route', () => {
  it('no source file links to the deleted /conditions page', () => {
    const offenders = files
      .filter(({ code }) => /['"`]\/conditions['"`]/.test(code))
      .map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })

  it('no source file renders a retired label for /terms or /privacy', () => {
    // Each of these named a document that already had a canonical name.
    const RETIRED = ['Conditions of Use', 'Terms of Service', 'Privacy Notice']
    const offenders = files.flatMap(({ rel, code }) =>
      RETIRED.filter((label) => code.includes(label)).map((label) => `${rel}: "${label}"`)
    )
    expect(offenders).toEqual([])
  })

  it('/conditions permanently redirects to /terms rather than 404ing', () => {
    // It had real inbound links from two auth pages, so a delete-to-404 would
    // throw away whatever equity and bookmarks it carried.
    const config = fs.readFileSync(NEXT_CONFIG, 'utf8')
    expect(config).toMatch(
      /source:\s*'\/conditions',\s*destination:\s*'\/terms',\s*permanent:\s*true/
    )
  })

  it('the storefront footer carries a Legal column', () => {
    // Before this, Terms and Privacy were reachable ONLY from /login and
    // /register — i.e. never from a page a signed-in shopper was actually on.
    const footer = fs.readFileSync(
      path.join(SRC_DIR, 'components', 'home', 'redesign', 'homeContent.ts'), 'utf8'
    )
    expect(footer).toContain("title: 'Legal'")
    expect(footer).toContain('LEGAL_LINK_LIST')
  })

  it('every legal page exports generateMetadata', () => {
    // Both were shipping bare: /terms because it was needlessly `'use client'`,
    // /privacy because nobody added it. Their admin-editable PageSeo overrides
    // were inert as a result.
    for (const page of ['terms', 'privacy']) {
      const src = fs.readFileSync(path.join(SRC_DIR, 'app', page, 'page.tsx'), 'utf8')
      expect(src).toContain('generateMetadata')
      expect(src).toContain(`buildPageMetadata('/${page}'`)
      // Comments stripped: the property is "no ACTIVE 'use client' directive",
      // and the note explaining why /terms stopped being one quotes the string.
      expect(stripComments(src)).not.toMatch(/^\s*['"]use client['"]/)
    }
  })

  it('every footer legal route is registered for admin SEO on the backend', () => {
    // House rule: a new page wires into the config-driven SEO system. A legal
    // link in the footer whose path is absent from STATIC_PAGES is a page no
    // admin can ever set a title on.
    const staticPages = fs.readFileSync(STATIC_PAGES, 'utf8')
    for (const route of ['/terms', '/privacy', '/shipping', '/warranty']) {
      expect(staticPages).toContain(`path: '${route}'`)
    }
  })
})
