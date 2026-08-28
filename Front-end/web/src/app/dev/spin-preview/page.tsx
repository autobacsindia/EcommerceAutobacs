import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PREVIEW_TOOLS_ENABLED } from '@/lib/previewTools';
import SpinPreviewClient from './SpinPreviewClient';

/**
 * Internal visual harness for the Spin-to-Win wheel.
 *
 * WHY THIS EXISTS: seeing the real wheel requires a live campaign, a paid order and a
 * Razorpay webhook. That is the right amount of friction for awarding real stock, and
 * completely the wrong amount for answering "does the t-shirt icon look okay". This
 * renders <SpinGauge> — the SAME component the customer sees — from a real campaign's
 * prizes, so the artwork you are looking at is the artwork that will ship.
 *
 * WHY IT IS GATED: house rule, no debug routes in production. See lib/previewTools —
 * ON for local + the Vercel preview tier, OFF on production unless someone explicitly
 * opts in. It is also in the robots disallow list, because the preview tier is publicly
 * reachable even though it is not meant to be found.
 *
 * WHAT THIS CANNOT TELL YOU: whether the wheel is wired to the customer flow. It renders
 * the component from admin data — a completely broken /spin/orders endpoint, a failing
 * eligibility check or a dead webhook would all still render here perfectly. It answers
 * "does it LOOK right", never "does the customer actually get it".
 */
export default function SpinPreviewPage() {
  if (!PREVIEW_TOOLS_ENABLED) notFound();
  // useSearchParams (the ?campaign= id) needs a Suspense boundary, or the build fails
  // the moment this page is eligible for prerendering.
  return (
    <Suspense fallback={<p className="p-10 text-center text-gray-500">Loading…</p>}>
      <SpinPreviewClient />
    </Suspense>
  );
}
