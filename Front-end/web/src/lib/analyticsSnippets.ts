/**
 * The inline analytics scripts, as exact strings — the SINGLE source of truth.
 *
 * WHY THIS FILE EXISTS
 * Public pages are statically rendered, so they cannot carry a per-request CSP
 * nonce (the HTML is built once and served to everyone). Their CSP therefore
 * allows these four snippets by SHA-256 HASH instead. A hash matches the script
 * body byte for byte — one changed space and the browser silently refuses to
 * run it, with no server-side trace.
 *
 * So the string that is hashed and the string that is rendered must be the same
 * string, not two copies that look alike. lib/csp.ts hashes these exports;
 * app/layout.tsx renders these exports. Never inline a snippet at either site.
 *
 * ⚠ These deliberately stay RAW <script> tags in the served HTML rather than
 * next/script. next/script serialises every strategy into
 * `(self.__next_s=…).push(…)` and replays it after hydration, which means the
 * served HTML contains no tag at all — Google's tag-coverage report listed live,
 * correctly-firing pages as "untagged", and fast bounces went uncounted. See the
 * comment block in app/layout.tsx. Do not "modernise" these.
 */

import { GTM_ID, GTM_DATA_LAYER } from './gtm';
import { GOOGLE_ADS_ID } from './googleAds';
import { META_PIXEL_ID } from './metaPixel';

/**
 * GTM's queue must exist before anything pushes to it: page-mount effects fire
 * the moment a route hydrates, and a push against an undefined array throws.
 * Note the name — `gtmDataLayer`, NOT the default `dataLayer` (see lib/gtm.ts:
 * sharing one array let GTM replay gtag's `config` and triple the page_views).
 */
export const gtmQueueSnippet = `window.${GTM_DATA_LAYER} = window.${GTM_DATA_LAYER} || [];`;

/**
 * Google's stock loader.
 *
 * ⚠ The `j.setAttribute('nonce', …)` line that used to be here is GONE, and it
 * had to go: a hashed script has no nonce to propagate. On the strict-CSP
 * routes `'strict-dynamic'` still extends trust from this hash-allowed script
 * to the gtm.js it injects, and onward to GTM's own tags — that is exactly what
 * strict-dynamic is for. The cost is browsers that do NOT support
 * strict-dynamic (pre-Chrome 52 / Firefox 52), where a Custom HTML tag added in
 * the GTM UI would now be blocked. The host allowlist in script-src covers
 * gtm.js itself on those browsers.
 */
export const gtmLoaderSnippet = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;
f.parentNode.insertBefore(j,f);
})(window,document,'script','${GTM_DATA_LAYER}','${GTM_ID}');`;

/**
 * The gtag stub + config MUST exist before any app code calls gtag(). Page-mount
 * effects fire events the moment a route hydrates (products/[slug] sends
 * view_item from SSR'd data); without the stub those events were dropped
 * SILENTLY, while events a beat later (begin_checkout, which waits on the cart)
 * got through — the half-working funnel once seen in Google Ads.
 *
 * ⚠ The gtag.js LOADER lives in here too, rather than as a sibling
 * `<script async src>` in the layout, and that is not a style choice.
 * 'strict-dynamic' makes browsers IGNORE every host-source in script-src, so a
 * parser-inserted <script src> is allowed only by its own nonce or hash — and
 * these snippets lost their nonce when the root layout stopped calling
 * headers(). A raw tag was therefore blocked on every strict route
 * (/checkout, /cart, /orders, /account, /profile, /wishlist, /admin), which
 * silently killed begin_checkout: the events queue into dataLayer and are never
 * sent, with nothing visible outside a browser console.
 *
 * Injecting it from THIS script fixes that: the snippet is hash-allowed, and
 * 'strict-dynamic' extends that trust to what it creates — exactly how the GTM
 * loader above already works, and the pattern Google documents for nonce/hash
 * CSPs. The URL still appears verbatim in the served HTML, so tag-coverage
 * checkers that read the markup still find it.
 */
export const googleAdsSnippet = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${GOOGLE_ADS_ID}');
(function(){var s=document.createElement('script');s.async=true;
s.src='https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}';
var f=document.getElementsByTagName('script')[0];f.parentNode.insertBefore(s,f);})();`;

/** Meta Pixel base. Fires PageView; the rest fire from their own pages. */
export const metaPixelSnippet = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`;

/**
 * Every inline snippet that may appear in a statically rendered page, in no
 * particular order. lib/csp.ts hashes ALL of them unconditionally — including
 * ones whose feature flag is off in this environment — because the hash list is
 * baked into a CSP that may be served from a cached page built under a
 * different configuration, and an unused hash costs nothing.
 */
export const INLINE_ANALYTICS_SNIPPETS: readonly string[] = [
  gtmQueueSnippet,
  gtmLoaderSnippet,
  googleAdsSnippet,
  metaPixelSnippet,
];
