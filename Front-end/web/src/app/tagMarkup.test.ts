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
const source = fs.readFileSync(LAYOUT, 'utf8')

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

  it.each(LOADERS)('$name is loaded from a raw <script>, never next/script', ({ marker }) => {
    expect(headBlock).toContain(marker)

    // Walk back from the loader to the element that renders it. A `<Script`
    // between them means next/script owns it and it will not be in the HTML.
    const upToLoader = headBlock.slice(0, headBlock.indexOf(marker))
    const lastRawScript = upToLoader.lastIndexOf('<script')
    const lastNextScript = upToLoader.lastIndexOf('<Script')

    expect(lastRawScript).toBeGreaterThan(-1)
    expect(lastNextScript).toBeLessThan(lastRawScript)
  })

  it('renders no next/script anywhere in the head tag block', () => {
    expect(headBlock).not.toContain('<Script')
  })

  /**
   * A script without the request nonce is blocked outright by the strict CSP
   * (lib/csp.ts) — the tag would go from "late" to "never".
   */
  it('nonces every tag script', () => {
    const scripts = headBlock.match(/<script\b[^>]*/g) ?? []
    expect(scripts.length).toBeGreaterThanOrEqual(4)
    for (const tag of scripts) expect(tag).toContain('nonce={nonce}')
  })

  /**
   * Ordering invariant: each queue must be created before the loader that
   * drains it, or early events are dropped. `dataLayer`/`gtag` must exist
   * before gtag.js, and `gtmDataLayer` before gtm.js.
   */
  it('creates each queue before the loader that drains it', () => {
    expect(headBlock.indexOf('window.${GTM_DATA_LAYER} = window.${GTM_DATA_LAYER} || []'))
      .toBeLessThan(headBlock.indexOf('googletagmanager.com/gtm.js'))
    expect(headBlock.indexOf('window.dataLayer = window.dataLayer || []'))
      .toBeLessThan(headBlock.indexOf('googletagmanager.com/gtag/js'))
  })

  /**
   * GTM must keep its own queue. Sharing `dataLayer` with the directly-loaded
   * Google tag let gtm.js replay gtag's `config AW-…` — measured 2x tag loads
   * and page_view beacons 1 → 3. See lib/gtm.ts.
   */
  it('keeps GTM on its own queue, not window.dataLayer', () => {
    expect(headBlock).toContain('${GTM_DATA_LAYER}')
    expect(headBlock).not.toContain("'dataLayer','${GTM_ID}'")
  })

  /** The blocking script must not block: gtag.js is the only src here. */
  it('loads the one external tag script asynchronously', () => {
    const gtagTag = headBlock.slice(
      headBlock.lastIndexOf('<script', headBlock.indexOf('googletagmanager.com/gtag/js')),
      headBlock.indexOf('googletagmanager.com/gtag/js')
    )
    expect(gtagTag).toContain('async')
  })
})
