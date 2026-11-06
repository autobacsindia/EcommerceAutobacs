import type { FestivalEngine } from './effects/engine';
import type { FestivalThemeTokens } from '@/lib/festival/themes';

let enginePromise: Promise<FestivalEngine | null> | null = null;
let engineKey: string | null = null;

/** True when the visitor asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Lazily import the effects engine (its own chunk) once per theme. Resolves to
 * null under reduced motion or if the chunk fails to load — effects are
 * optional, so a failure is silent.
 */
export function loadEngine(tokens: FestivalThemeTokens): Promise<FestivalEngine | null> {
  if (prefersReducedMotion()) return Promise.resolve(null);
  if (enginePromise && engineKey === tokens.key) return enginePromise;
  engineKey = tokens.key;
  enginePromise = import('./effects/engine')
    .then(({ createEngine, computeQuality }) =>
      createEngine({
        colors: tokens.particles,
        lamp: tokens.icons.lamp,
        glow: tokens.colors.glow,
        quality: computeQuality(),
      }),
    )
    .catch(() => {
      enginePromise = null;
      return null;
    });
  return enginePromise;
}

/**
 * Stop and remove anything on screen. Called when the page leaves a festive
 * route (e.g. Buy now → checkout), so no spark ever lingers over checkout.
 */
export function stopEngine(): void {
  void enginePromise?.then((engine) => engine?.destroy());
}

/** Test hook. */
export function resetEngineForTests() {
  enginePromise = null;
  engineKey = null;
}
