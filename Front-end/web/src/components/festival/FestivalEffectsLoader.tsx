'use client';

import dynamic from 'next/dynamic';
import { loadOptionalChunk } from '@/lib/loadOptionalChunk';

/**
 * The effects wiring as its own client-only chunk: no SSR, nothing in the
 * server HTML, and the engine inside it is a further lazy import.
 *
 * This renders from the ROOT layout, above every error boundary, so a failed
 * chunk download here used to blank every page on the site (the 2026-11 careers
 * outage). The effects are pure decoration: if the chunk will not load, the
 * page simply goes without them. See lib/loadOptionalChunk.ts.
 */
const FestivalEffects = dynamic(
  loadOptionalChunk(() => import('./FestivalEffects'), {
    onGiveUp: (err) => console.warn('[festival] effects chunk failed to load; continuing without effects', err),
  }),
  { ssr: false },
);

export default function FestivalEffectsLoader() {
  return <FestivalEffects />;
}
