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

export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';

  // script-src:
  //   'nonce-{n}'      — only scripts carrying this nonce may execute inline.
  //   'strict-dynamic' — trust propagates to scripts loaded by a nonce'd script,
  //                      so Razorpay can load its own sub-scripts. Domain
  //                      allow-lists below are a fallback for browsers without it.
  //   'unsafe-eval'    — dev only, for React Fast Refresh (HMR).
  //   'wasm-unsafe-eval' — allows WebAssembly.instantiate (the Draco glTF
  //                      decoder that powers the home 3D car) WITHOUT permitting
  //                      general eval(); required in prod where 'unsafe-eval' is
  //                      stripped. Without it the .glb never decodes → blank canvas.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    'https://checkout.razorpay.com',
    // Affordability/EMI widget on the PDP (RazorpayAffordabilitySuite).
    'https://cdn.razorpay.com',
    'https://maps.googleapis.com',
    // Google Tag (gtag.js) for Google Ads conversion tracking. 'strict-dynamic'
    // already trusts the sub-scripts the nonce'd loader pulls in; these explicit
    // entries are the fallback for browsers that ignore 'strict-dynamic'.
    // googleadservices.com serves the conversion linker / conversion_async.js.
    'https://www.googletagmanager.com',
    'https://www.googleadservices.com',
    // Meta Pixel loader (fbevents.js). 'strict-dynamic' already trusts it via the
    // nonce'd init snippet; this is the fallback for browsers ignoring strict-dynamic.
    'https://connect.facebook.net',
    // Microsoft Clarity (session replay), injected by the GTM container. Same
    // fallback role — 'strict-dynamic' already trusts what GTM injects.
    'https://*.clarity.ms',
  ].join(' ');

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
    `connect-src 'self' ${R2_UPLOAD_ORIGIN} https://api.cloudinary.com https://*.ingest.sentry.io https://r.lr-ingest.io https://api.razorpay.com https://cdn.razorpay.com https://lumberjack.razorpay.com https://maps.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.google.com https://www.google.co.in https://google.com https://google.co.in https://googleads.g.doubleclick.net https://www.googleadservices.com https://ad.doubleclick.net https://www.facebook.com https://connect.facebook.net https://*.clarity.ms`,
    // Razorpay renders its payment UI (checkout) and the EMI affordability
    // widget's "View plans" modal inside iframes. googletagmanager.com is the
    // GTM <noscript> ns.html iframe (layout.tsx) — without it that fallback is
    // CSP-blocked for JS-less visitors, silently and only for them.
    "frame-src https://api.razorpay.com https://checkout.razorpay.com https://cdn.razorpay.com https://www.googletagmanager.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://api.razorpay.com",
    "upgrade-insecure-requests",
  ].join('; ');
}
