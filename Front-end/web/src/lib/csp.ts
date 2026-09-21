import { INLINE_ANALYTICS_SNIPPETS } from './analyticsSnippets';
/**
 * Content-Security-Policy for every HTML response.
 *
 * Lives outside middleware.ts so it can be unit-tested: importing the middleware
 * pulls in next/server, which needs the edge runtime globals. The policy itself
 * is the thing worth testing — a missing directive fails silently for the user.
 */
/**
 * Origin the browser PUTs direct uploads to under the R2 storage path.
 *
 * ⚠ R2 presigns VIRTUAL-HOSTED style, so the bucket is part of the host:
 *     https://<bucket>.<account-id>.r2.cloudflarestorage.com
 * and we use two buckets (public for imagery, private for CVs / return evidence
 * / slips). A CSP source matches the host exactly unless it carries a wildcard,
 * so the bare account endpoint matches NEITHER bucket. Set this to the
 * account-scoped wildcard, which covers both and nothing outside our account:
 *
 *     NEXT_PUBLIC_R2_S3_ENDPOINT=https://*.<account-id>.r2.cloudflarestorage.com
 *
 * Getting this subtly wrong is worse than leaving it unset, because the failure
 * is invisible: the browser blocks the PUT before it leaves the page, so there
 * is no server log and no failed request to find — just a generic "upload
 * failed" the customer sees and we do not.
 *
 * The fallback is the same wildcard one level wider (any R2 account). It exists
 * so a forgotten or malformed variable degrades to "works, but broader than
 * necessary" rather than "every upload silently fails". It costs little in
 * practice: `connect-src` already allows api.cloudinary.com, which accepts
 * uploads to any cloud name, so the exfiltration door it guards is open anyway.
 */
const R2_UPLOAD_ORIGIN =
  process.env.NEXT_PUBLIC_R2_S3_ENDPOINT || 'https://*.r2.cloudflarestorage.com';

/**
 * Base64 SHA-256 of each inline analytics snippet, computed once per runtime.
 *
 * These exist because those snippets no longer carry a nonce: the root layout
 * cannot mint one without opting every route out of static rendering. On the
 * strict routes the hash is what allows them, and 'strict-dynamic' then extends
 * trust to the libraries they inject.
 *
 * Memoised as a promise at module scope — crypto.subtle is async and middleware
 * runs on every request, so hashing four strings per request would be pure
 * waste. The Edge runtime provides Web Crypto.
 */
let hashesPromise: Promise<string[]> | null = null;

async function snippetHashes(): Promise<string[]> {
  if (!hashesPromise) {
    hashesPromise = Promise.all(
      INLINE_ANALYTICS_SNIPPETS.map(async (snippet) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snippet));
        // btoa over the raw bytes — the encoding CSP expects.
        const bytes = new Uint8Array(digest);
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return `'sha256-${btoa(binary)}'`;
      }),
      // ⚠ Drop a REJECTED promise from the cache. Memoising the rejection would
      // make one transient crypto failure permanent: every later request awaits
      // the same settled rejection, middleware throws, and every strict route —
      // /checkout included — 500s until the next deploy. Clearing it means the
      // next request simply tries again.
    ).catch((err) => {
      hashesPromise = null;
      throw err;
    });
  }
  return hashesPromise;
}

/**
 * Everything except script-src, which is the only directive the two policies
 * disagree on. Shared so a new connect-src host or frame-src entry cannot be
 * added to one policy and forgotten in the other — a drift that would present
 * as "works on the product page, blocked at checkout".
 */
function buildPolicy(scriptSrc: string): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // 'unsafe-inline' is required for style-src: the CSP spec does not support
    // nonces on style="" attributes, only on <style> elements. React libraries
    // (react-hot-toast, next/font, Tailwind utilities) emit inline style
    // attributes that cannot be nonce'd. CSS-injection risk is low; the
    // meaningful gain is script-src keeping its strict nonce policy.
    "style-src 'self' 'unsafe-inline'",
    // images.unsplash.com = temporary home-redesign placeholder imagery; safe to
    // remove once all artwork is hosted on Cloudinary (res.cloudinary.com).
    // cdn.razorpay.com serves the EMI widget's bank/lender logos.
    // Google Ads / gtag fire conversion tracking as <img> pixel beacons to
    // google.com/pagead, googleadservices.com and googleads.g.doubleclick.net —
    // without these the conversion never reaches Google even though the script ran.
    // (Verified against a live Vercel preview: the googleadservices.com + doubleclick
    // beacons were CSP-blocked until added here.)
    // Meta Pixel fires tracking as <img> beacons to www.facebook.com/tr.
    //
    // *.clarity.ms — Microsoft Clarity, added as a tag in the GTM container. It
    // posts session data to <region>.clarity.ms/collect and a c.clarity.ms/c.gif
    // pixel; both were blocked in PRODUCTION on 2026-09-03 while the tag script
    // itself loaded fine on 'strict-dynamic'. So GTM Preview showed the tag
    // firing, Clarity looked installed, and it recorded NOTHING. Every tag added
    // in the GTM UI needs its endpoints here — the script loading is not evidence
    // that the tag works. The region host varies (l./k./e./z.), hence a wildcard.
    //
    // c.bing.com is not a second tracker to approve — it is the SAME pixel:
    // c.clarity.ms/c.gif answers 302 → c.bing.com/c.gif (Clarity's MUID sync).
    // CSP is enforced on every redirect hop, and Chrome reports the violation
    // against the ORIGINAL url, so allowing *.clarity.ms alone still logged
    // "img-src blocked https://c.clarity.ms/c.gif" and read as if the wildcard
    // had not worked. Exact host, not a wildcard: nothing else on bing.com is
    // wanted. Drop this line if the Clarity↔Microsoft Advertising sync is not
    // used — replay works without it, at the cost of one violation per page.
    "img-src 'self' data: blob: https://img.autobacsindia.com https://res.cloudinary.com https://images.unsplash.com https://*.gstatic.com https://*.googleapis.com https://cdn.razorpay.com https://www.googletagmanager.com https://www.google.com https://www.google.co.in https://google.com https://google.co.in https://googleads.g.doubleclick.net https://www.google-analytics.com https://www.googleadservices.com https://ad.doubleclick.net https://www.facebook.com https://connect.facebook.net https://*.clarity.ms https://c.bing.com",
    "font-src 'self' data:",
    // blob: for LogRocket session-replay web workers spawned by the npm SDK
    "worker-src blob: 'self'",
    // api.cloudinary.com: admin image uploads AND careers applicant videos/PDFs
    // go browser→Cloudinary directly (signed), bypassing our API + the proxy
    // request-body limit. (The careers flow previously used Google Drive + a
    // Google Apps Script web app — script.google.com / script.googleusercontent.com
    // / www.googleapis.com — now removed after the in-house migration.)
    //
    // R2_UPLOAD_ORIGIN is the same door for the R2 path: a presigned PUT goes
    // browser→<account>.r2.cloudflarestorage.com. Private-bucket objects have no
    // custom domain by design, so there is no narrower host to allow.
    // Trailing Google Tag / Ads entries: gtag.js XHR/beacon endpoints for
    // loading config and posting the purchase conversion. googleadservices.com +
    // ad.doubleclick.net + the regional google.co.in are the enhanced-conversion /
    // conversion-linker fetch targets (were CSP-blocked on the preview until added).
    //
    // ⚠ The APEX hosts (google.com / google.co.in) are listed SEPARATELY from the
    // www ones because a CSP host source matches one exact host — "www.google.com"
    // does NOT cover "google.com". Chrome reported this on prod on 2026-09-04:
    //     Refused to connect to 'https://google.com/ccm/form-data/<ads-id>'
    // which is the Google tag's enhanced-conversions form-data endpoint, silently
    // dropped on every product page while www.google.com sat in the list looking
    // like it covered it. Same trap as the clarity.ms → c.bing.com redirect above.
    `connect-src 'self' ${R2_UPLOAD_ORIGIN} https://api.cloudinary.com https://*.ingest.sentry.io https://r.lr-ingest.io https://api.razorpay.com https://cdn.razorpay.com https://lumberjack.razorpay.com https://maps.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://analytics.google.com https://www.google.com https://www.google.co.in https://google.com https://google.co.in https://googleads.g.doubleclick.net https://stats.g.doubleclick.net https://www.googleadservices.com https://ad.doubleclick.net https://www.facebook.com https://connect.facebook.net https://*.clarity.ms`,
    // Razorpay renders its payment UI (checkout) and the EMI affordability
    // widget's "View plans" modal inside iframes. googletagmanager.com is the
    // GTM <noscript> ns.html iframe (layout.tsx) — without it that fallback is
    // CSP-blocked for JS-less visitors, silently and only for them.
        // www.facebook.com: the Meta Pixel frames facebook.com to sync its cookie.
    // Blocked in production until 2026-09-21 — browser-verified, and invisible
    // from the server because a blocked frame produces no request to log.
    "frame-src https://api.razorpay.com https://checkout.razorpay.com https://cdn.razorpay.com https://www.googletagmanager.com https://www.facebook.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
        // www.facebook.com: when a pixel payload is too large for a GET beacon the
    // Meta Pixel falls back to POSTing a form to facebook.com/tr/. Without this
    // those events are dropped silently — form-action violations do not surface
    // anywhere except a browser console.
    "form-action 'self' https://api.razorpay.com https://www.facebook.com",
    "upgrade-insecure-requests",
  ].join('; ');
}

/**
 * ── Two policies, because a nonce and a cached page are mutually exclusive ──
 *
 * A nonce must differ per response; a statically rendered page is built once
 * and served to everyone. There is no third option in Next 15 — so the routes
 * that are cached and the routes that carry a nonce are disjoint sets, and the
 * middleware picks per request (see isStrictCspPath in middleware.ts).
 *
 * ⚠ Getting the pairing wrong is catastrophic AND SILENT: serving the strict,
 * nonce-bearing policy over prerendered HTML (which contains no nonces) means
 * 'strict-dynamic' discards the 'self' source and the browser blocks EVERY
 * script on the page. The build passes, the tests pass, curl looks healthy, and
 * only a browser console shows the site is inert. Measured on the spike build.
 */

/** Hosts allowed to serve scripts, shared by both policies. */
const SCRIPT_HOSTS = [
  'https://checkout.razorpay.com',
  // Affordability/EMI widget on the PDP (RazorpayAffordabilitySuite).
  'https://cdn.razorpay.com',
  'https://maps.googleapis.com',
  // Google Tag (gtag.js) for Ads conversion tracking. Under the strict policy
  // 'strict-dynamic' already trusts what the nonce'd/hashed loaders pull in;
  // these entries are the fallback for browsers that ignore strict-dynamic, and
  // the PRIMARY mechanism under the public policy, which has no strict-dynamic.
  'https://www.googletagmanager.com',
  'https://www.googleadservices.com',
  // Meta Pixel loader (fbevents.js).
  'https://connect.facebook.net',
  // Microsoft Clarity (session replay), injected by the GTM container.
  'https://*.clarity.ms',
  // ── Hosts gtag/GTM inject scripts FROM ───────────────────────────────────
  // These were already trusted in img-src/connect-src but were missing here.
  // Under the STRICT policy that was survivable ('strict-dynamic' propagates
  // trust to whatever a trusted script inserts, so host entries are ignored).
  // Under the PUBLIC policy there is no 'strict-dynamic' — the host allowlist
  // is the ONLY gate — so on ~all storefront traffic a script injected from any
  // of these would simply be blocked, silently.
  'https://www.google-analytics.com',
  'https://googleads.g.doubleclick.net',
  'https://ad.doubleclick.net',
  // Deliberately NOT added: www.google.com / google.co.in. They appear in
  // connect-src and img-src for the enhanced-conversions /ccm/form-data
  // endpoint and the pagead beacons, which are fetches and pixels — not
  // scripts. Adding a host that broad to script-src would widen the policy for
  // no demonstrated load.
].join(' ');

/**
 * STRICT — for dynamically rendered routes only (checkout, account, orders,
 * cart, admin, …). Per-request nonce + 'strict-dynamic'.
 *
 * The snippet hashes are here because the four inline analytics scripts in the
 * root layout no longer carry a nonce; the root layout cannot mint one without
 * making every route dynamic again. A hash-allowed script propagates
 * 'strict-dynamic' trust exactly as a nonce'd one does.
 */
export async function buildStrictCsp(nonce: string): Promise<string> {
  const isDev = process.env.NODE_ENV !== 'production';
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(await snippetHashes()),
    // Allows WebAssembly.instantiate (the Draco glTF decoder behind the home 3D
    // car) WITHOUT permitting general eval(); required in prod where
    // 'unsafe-eval' is stripped. Without it the .glb never decodes.
    "'wasm-unsafe-eval'",
    ...(isDev ? ["'unsafe-eval'"] : []), // React Fast Refresh (HMR)
    SCRIPT_HOSTS,
  ].join(' ');
  return buildPolicy(scriptSrc);
}

/**
 * PUBLIC — for statically rendered / cacheable routes.
 *
 * No nonce (impossible in prebuilt HTML) and therefore no 'strict-dynamic',
 * which without a nonce or hash anchor would block everything.
 *
 * 'unsafe-inline' is required, not preferred: Next emits its React flight data
 * as inline `self.__next_f.push(...)` scripts whose content differs per page
 * and per build, so they cannot be hashed. Note that adding any hash or nonce
 * to this list would make browsers IGNORE 'unsafe-inline' and break hydration —
 * which is why the snippet hashes are deliberately absent here.
 *
 * The trade, stated plainly: an injected <script> in stored HTML would execute
 * on these pages. The remaining defence is server-side sanitization
 * (Back-end/server/utils/htmlSanitizer.js — cleanHTML for product copy, reviews
 * and Q&A; cleanArticleHTML for the blog).
 */
export function buildPublicCsp(): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    SCRIPT_HOSTS,
  ].join(' ');
  return buildPolicy(scriptSrc);
}
