/**
 * Real 3D car models shipped inside the app, by car slug (slots.ts).
 *
 * The .glb files live in `assets/models/` (see CREDITS.md there). Metro bundles
 * them as assets (metro.config.js adds 'glb'), so they work offline and ship
 * with each app build. How the scene stands each model is in scene.src.js MODELS.
 *
 * NOT pure (uses require for assets): keep it out of node --test files.
 */

export interface ShowroomModel {
  /** Metro asset module for the .glb. */
  asset: number;
  /** Licence credit shown on the showroom screen (CC BY needs it). */
  credit: string;
}

const MODELS: Record<string, ShowroomModel> = {
  'toyota-hilux': {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    asset: require('../../../assets/models/toyota-hilux.glb'),
    credit: '3D model "2022 Toyota Hilux" by BHP3D, CC BY 4.0, adapted',
  },
};

export function showroomModel(slug: string): ShowroomModel | null {
  return MODELS[slug] ?? null;
}
