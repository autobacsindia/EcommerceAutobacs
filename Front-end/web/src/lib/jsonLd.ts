/**
 * JSON-LD helpers.
 *
 * `serializeJsonLd` was copy-pasted into two page files before this; a third
 * copy was about to be added for the About page. The escaping is the part that
 * matters — it is what stops a product name or a company description ending a
 * <script> block early — so it belongs in one place where it can be fixed once.
 */

/**
 * Serialise structured data for a <script type="application/ld+json"> block.
 *
 * `<`, `>` and `&` are escaped as JSON unicode: without that, a value
 * containing `</script>` would terminate the tag and the rest would render as
 * page markup. The escapes are still valid JSON, so crawlers read them fine.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** The company, as every page should describe it. One definition, no drift. */
export const ORGANISATION = {
  '@type': 'Organization',
  name: 'Autobacs India',
  legalName: 'Roavion Automotive Pvt. Ltd.',
  url: 'https://www.autobacsindia.com/',
  logo: 'https://img.autobacsindia.com/variants/autobacs/site/roavion-primary-trimmed/w640',
  // Taken verbatim from the About page's own hero copy, so the structured data
  // and the page a visitor reads cannot say different things.
  description:
    'Premium automotive parts, custom builds, dealer supply and 42 fitment points across India, since 2015.',
  foundingDate: '2015',
  sameAs: [
    'https://www.instagram.com/autobacsindia/',
    'https://www.linkedin.com/company/107129492',
    'https://www.facebook.com/autobacsindia',
  ],
} as const;
