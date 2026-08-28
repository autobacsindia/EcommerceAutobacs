/**
 * Are the internal preview/debug tools available on this deployment?
 *
 * The problem this solves: `NODE_ENV` is "production" for EVERY Vercel build, including
 * the preview tier. So `NODE_ENV !== 'production'` means "local dev only" and would keep
 * these tools off exactly where they are most wanted — the test tier, where you want to
 * check a campaign without putting a real order through Razorpay.
 *
 * The three ways in, and why each exists:
 *
 *   NODE_ENV !== 'production'              → local `npm run dev`.
 *   NEXT_PUBLIC_VERCEL_ENV === 'preview'   → Vercel's own value for a non-production
 *                                            deployment. On the production deployment it
 *                                            reads "production", so prod stays off with
 *                                            no configuration at all — which is the point:
 *                                            the safe state must be the default state.
 *   NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS       → explicit escape hatch, for a test tier that
 *                                            is NOT a Vercel preview deployment (a second
 *                                            Vercel project, or Railway) and therefore
 *                                            reports VERCEL_ENV=production.
 *
 * ⚠️ NEXT_PUBLIC_* is inlined at BUILD time, so flipping this in a dashboard needs a
 * redeploy to take effect — it is not a runtime switch.
 *
 * ⚠️ Setting NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS on the PRODUCTION project puts a debug
 * route on the live storefront. It is deliberately an opt-in you have to type out.
 */
export const PREVIEW_TOOLS_ENABLED =
  process.env.NODE_ENV !== 'production'
  || process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
  || process.env.NEXT_PUBLIC_VERCEL_ENV === 'development'
  || process.env.NEXT_PUBLIC_ENABLE_PREVIEW_TOOLS === 'true';
