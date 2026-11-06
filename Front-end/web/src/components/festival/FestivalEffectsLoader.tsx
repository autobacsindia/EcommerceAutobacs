'use client';

import dynamic from 'next/dynamic';

/**
 * The effects wiring as its own client-only chunk: no SSR, nothing in the
 * server HTML, and the engine inside it is a further lazy import.
 */
const FestivalEffects = dynamic(() => import('./FestivalEffects'), { ssr: false });

export default function FestivalEffectsLoader() {
  return <FestivalEffects />;
}
