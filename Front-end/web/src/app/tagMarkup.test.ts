/**
 * Third-party tag markup guard.
 *
 * The Google Ads tag, the GTM container and the Meta Pixel must exist as REAL
 * <script> elements in the server-rendered HTML.
 *
 * next/script does not do that. Every strategy — including
 * `beforeInteractive` — is emitted as a JSON string inside
 * `(self.__next_s=…).push([…])` and replayed only once the client bundle boots.
 * In the App Router "beforeInteractive" means before HYDRATION, not "in the
 * <head>". Verified on prod 2026-09-04: the served HTML of every page contained
 * no Google tag at all, so Google's tag-coverage report listed live,
 * correctly-firing pages as "untagged", and any visitor who left before the
 * bundle executed was never counted.
 *
 * That regression is invisible in review — <Script> vs <script> is one
 * character, both render, both fire for a user who stays — and invisible in a
 * browser, because the tag DOES eventually load. Hence a structural test: it
 * fails on the file, not on a symptom.
 */

import fs from 'fs'
import path from 'path'

const LAYOUT = path.join(process.cwd(), 'src', 'app', 'layout.tsx')
const SNIPPETS = path.join(process.cwd(), 'src', 'lib', 'analyticsSnippets.ts')
const source = fs.readFileSync(LAYOUT, 'utf8')
const snippetSource = fs.readFileSync(SNIPPETS, 'utf8')

/**
 * The snippet BODIES moved to lib/analyticsSnippets.ts so lib/csp.ts can hash
 * the exact same strings the layout renders (they carry no nonce any more —
 * see the CSP split). The loader URLs therefore live there, while the layout
 * still owns how they are RENDERED, which is what this file guards. Marker
 * checks span both; `<Script>` checks stay on the layout.
 */
const tagSource = `${snippetSource}\n${source}`

/**
 * The tag block: everything between the preconnect hints and </head>, with JSX
 * comments removed. The comments in that block discuss `<script>` and `<Script>`
 * by name, so scanning them as if they were markup gives false results in both
 * directions.
 */
const headBlock = source
  .slice(source.lastIndexOf('{/*', source.indexOf('Third-party tags')), source.indexOf('</head>'))
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('third-party tags are real markup in the served HTML', () => {
  it('has a head block to check (guards against this test silently passing)', () => {
    expect(source).toContain('Third-party tags')
    expect(headBlock.length).toBeGreaterThan(500)
  })

  /**
   * Each entry is a tag whose absence from the HTML is externally visible —
   * Google's tag coverage report for the first two, Meta's "pixel not
   * detected" diagnostic for the third.
   */
  const LOADERS: { name: string; marker: string }[] = [
    { name: 'GTM container', marker: 'googletagmanager.com/gtm.js' },
    { name: 'Google Ads gtag.js', marker: 'googletagmanager.com/gtag/js' },
    { name: 'Meta Pixel fbevents.js', marker: 'connect.facebook.net/en_US/fbevents.js' },
  ]

  it.each(LOADERS)('$name still appears in the tag sources', ({ marker }) => {
    // In the layout (gtag.js, a src attribute) or in the snippet bodies
    // (gtm.js, fbevents.js). Either way it must reach the served HTML.
    expect(tagSource).toContain(marker)
  })

  it('renders every tag through a raw <script>, never next/script', () => {
    // The head block is where they are rendered. One `<Script` here and the tag
    // leaves the served HTML entirely — the 2026-09-04 regression.
    const rawScripts = (headBlock.match(/<script\b/g) ?? []).length
    expect(rawScripts).toBeGreaterThanOrEqual(4)
    expect(headBlock).not.toContain('<Script')
  })

  it('renders no next/script anywhere in the head tag block', () => {
    expect(headBlock).not.toContain('<Script')
  })

  /**
   * INVERTED on purpose. These scripts used to carry nonce={nonce}; they must
   * NOT any more.
   *
   * The root layout no longer calls headers() — that single dynamic API was
   * opting every route in the app out of static rendering. Without it there is
   * no per-request nonce to stamp, so the strict CSP allows these snippets by
   * SHA-256 hash instead (lib/csp.ts buildStrictCsp).
   *
   * A stray nonce={nonce} here would not just be dead: `nonce` is no longer in
   * scope, so it would fail the build — and if it were reintroduced along with
   * headers(), prerendering would silently collapse back to zero routes.
   */
  it('does not nonce the tag scripts — they are hash-allowed now', () => {
    expect(headBlock).not.toContain('nonce={nonce}')
  })

  it('keeps the snippet bodies in the module the CSP hashes', () => {
    // If a body is inlined back into the layout, the hash in the CSP stops
    // matching it and the script is silently refused on every strict route.
    for (const name of ['gtmQueueSnippet', 'gtmLoaderSnippet', 'googleAdsSnippet', 'metaPixelSnippet']) {
      expect(headBlock).toContain(name)
      expect(snippetSource).toContain(`export const ${name}`)
    }
  })

  /**
   * Ordering invariant: each queue must be created before the loader that
   * drains it, or early events are dropped. `dataLayer`/`gtag` must exist
   * before gtag.js, and `gtmDataLayer` before gtm.js.
   */
  it('creates each queue before the loader that drains it', () => {
    // Queue creation and loader now both live in the snippet module; the
    // render order in the layout is asserted separately below.
    expect(snippetSource.indexOf('window.${GTM_DATA_LAYER} = window.${GTM_DATA_LAYER} || []'))
      .toBeLessThan(snippetSource.indexOf('googletagmanager.com/gtm.js'))
    expect(headBlock.indexOf('gtmQueueSnippet')).toBeLessThan(headBlock.indexOf('gtmLoaderSnippet'))
    // The gtag stub and the gtag.js loader are now BOTH inside googleAdsSnippet
    // (the loader moved there because a bare <script src> carries neither nonce
    // nor hash and is blocked under 'strict-dynamic'). So the ordering check
    // belongs within that one string.
    const ads = snippetSource.slice(snippetSource.indexOf('export const googleAdsSnippet'))
    expect(ads.indexOf('window.dataLayer = window.dataLayer || []'))
      .toBeLessThan(ads.indexOf('googletagmanager.com/gtag/js'))
  })

  /**
   * GTM must keep its own queue. Sharing `dataLayer` with the directly-loaded
   * Google tag let gtm.js replay gtag's `config AW-…` — measured 2x tag loads
   * and page_view beacons 1 → 3. See lib/gtm.ts.
   */
  it('keeps GTM on its own queue, not window.dataLayer', () => {
    expect(snippetSource).toContain('${GTM_DATA_LAYER}')
    expect(snippetSource).not.toContain("'dataLayer','${GTM_ID}'")
  })

  /** The blocking script must not block: gtag.js is the only src here. */
  it('loads gtag.js asynchronously, and by injection rather than a bare tag', () => {
    const ads = snippetSource.slice(snippetSource.indexOf('export const googleAdsSnippet'))
    // async so it never blocks the parser…
    expect(ads).toContain('s.async=true')
    // …and created by script, so 'strict-dynamic' can extend this snippet's
    // hash-derived trust to it. A parser-inserted <script src> would be blocked
    // on every strict route, silently killing begin_checkout.
    expect(ads).toContain("document.createElement('script')")
    expect(headBlock).not.toContain('googletagmanager.com/gtag/js')
  })
})
