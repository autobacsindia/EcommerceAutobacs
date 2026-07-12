'use client';

import { useEffect, useState } from 'react';

/**
 * Decides whether to render the heavy 3D car (react-three-fiber) or the light
 * static/SVG fallback.
 *
 * Returns `false` on the server AND on the first client render, then re-evaluates
 * after mount — so SSR and first paint always show the static path (no hydration
 * mismatch), and 3D is a post-mount progressive enhancement.
 *
 * 3D is enabled only when ALL hold:
 *   - viewport ≥ md (768px)  — small screens get the SVG by design
 *   - WebGL is actually available
 *   - user hasn't asked to reduce motion
 *   - the browser isn't in data-saver mode
 *   - device isn't obviously low-powered (cores / memory heuristics)
 */
export function useCanRender3D(): boolean {
  const [can, setCan] = useState(false);

  useEffect(() => {
    const evaluate = () => {
      // Respect motion + data-saver preferences.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      if (window.matchMedia('(min-width: 768px)').matches === false) return false;

      const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (conn?.saveData) return false;

      // Low-power heuristics (best-effort; undefined => don't penalize).
      const cores = navigator.hardwareConcurrency;
      if (typeof cores === 'number' && cores > 0 && cores < 4) return false;
      const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      if (typeof mem === 'number' && mem > 0 && mem < 4) return false;

      // WebGL support probe.
      try {
        const canvas = document.createElement('canvas');
        const gl =
          canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl');
        if (!gl) return false;
      } catch {
        return false;
      }

      return true;
    };

    const update = () => setCan(evaluate());
    update();

    // Re-evaluate on resize (crossing the md breakpoint) and motion-pref change.
    const mqWidth = window.matchMedia('(min-width: 768px)');
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    mqWidth.addEventListener('change', update);
    mqMotion.addEventListener('change', update);
    return () => {
      mqWidth.removeEventListener('change', update);
      mqMotion.removeEventListener('change', update);
    };
  }, []);

  return can;
}
