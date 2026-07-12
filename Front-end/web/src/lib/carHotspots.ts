import { serverFetch } from '@/lib/server-api';

/**
 * Interactive-car "explorer": a user points at a part of the vehicle and is
 * taken to the matching category listing.
 *
 * Design mirrors `navCategories.ts`: each hotspot declares ORDERED `slugAliases`
 * and we resolve against the LIVE categories API, linking to the category's real
 * slug. Hotspots whose category no longer exists (renamed/merged/deactivated)
 * are dropped, so the explorer never renders a broken link. This keeps the
 * feature resilient to taxonomy drift — the same risk the brand-collapse
 * cleanup created when slugs moved around.
 *
 * Slugs below were verified against the live production taxonomy (12 hubs /
 * ~298 active categories). `position` is a percentage offset over the explorer
 * artwork (top-left origin) and MUST be tuned to whichever car asset is shipped
 * — they are render-agnostic (image overlay today, 3D mesh anchor later).
 */

export type CarRegion =
  | 'front'
  | 'hood'
  | 'roof'
  | 'side'
  | 'wheel'
  | 'rear'
  | 'interior';

export interface CarHotspotDef {
  /** Stable id (analytics, React key, mesh name in the glTF for raycasting). */
  id: string;
  /** Human label shown in the tooltip / accessible link text. */
  label: string;
  region: CarRegion;
  /** Ordered preference — first alias that matches a live category wins. */
  slugAliases: string[];
  /** 2D overlay anchor as % of the SVG/static view box (mobile + fallback). */
  position: { x: number; y: number };
  /** Optional world-space anchor for the 3D (glTF) renderer; set once the model lands. */
  anchor3d?: { x: number; y: number; z: number };
  /**
   * Abstract hubs with no natural point on the vehicle (accessories,
   * portable-fridge) render as chips beside the car instead of a marker.
   */
  chip?: boolean;
}

export interface ResolvedCarHotspot {
  id: string;
  label: string;
  region: CarRegion;
  href: string;
  position: { x: number; y: number };
  anchor3d?: { x: number; y: number; z: number };
  chip?: boolean;
}

interface ApiCategory {
  _id?: string;
  name?: string;
  slug?: string;
  isActive?: boolean;
}

/**
 * HUB-LEVEL hotspots: one marker per live category hub, anchored to where that
 * hub's parts physically sit on the vehicle. Clicking opens `/categories/<hub>`.
 *
 * `slugAliases[0]` is the current live hub slug; extra aliases are graceful
 * fallbacks if a hub is renamed (the resolver drops any hub that no longer
 * resolves, so this never renders a broken link).
 *
 * `position` is the 2D anchor (% of the SVG/static view — the mobile + fallback
 * renderer). `anchor3d` is filled in later, per the supplied glTF model, for the
 * 3D renderer. Two hubs have no natural point on the car (`accessories`,
 * `portable-fridge`) → `chip: true`, rendered as chips beside the vehicle.
 *
 * Verified against live hubs 2026-06-29:
 *   lighting, exterior, interior, suspension, roof-top, protection-kit,
 *   body-kits, performance, accessories, audio, brakes, portable-fridge.
 */
// anchor3d in model space (verified against the render): X=width (near-visible
// side = +1.04), Y=height (ground 0 .. roof 1.89), Z=length (FRONT ≈ -2.4,
// REAR ≈ +2.9). Tuned 2026-07-12 against the Playwright capture.
export const CAR_HOTSPOTS: CarHotspotDef[] = [
  { id: 'lighting', label: 'Lighting', region: 'front',
    slugAliases: ['lighting', 'car-lighting'], position: { x: 60.9, y: 41.3 }, anchor3d: { x: 0.55, y: 0.95, z: -2.15 } },
  { id: 'performance', label: 'Performance', region: 'hood',
    slugAliases: ['performance'], position: { x: 60.9, y: 36.5 }, anchor3d: { x: 0, y: 1.1, z: -1.7 } },
  { id: 'exterior', label: 'Exterior', region: 'side',
    slugAliases: ['exterior'], position: { x: 42.7, y: 36.0 }, anchor3d: { x: 1.05, y: 1.0, z: 0.3 } },
  { id: 'body-kits', label: 'Body Kits', region: 'front',
    slugAliases: ['body-kits'], position: { x: 62.3, y: 47.5 }, anchor3d: { x: 0.35, y: 0.55, z: -2.2 } },
  { id: 'protection-kit', label: 'Protection Kit', region: 'front',
    slugAliases: ['protection-kit'], position: { x: 65.3, y: 50.0 }, anchor3d: { x: 0, y: 0.35, z: -2.35 } },
  { id: 'roof-top', label: 'Roof Top', region: 'roof',
    slugAliases: ['roof-top'], position: { x: 51.1, y: 22.9 }, anchor3d: { x: 0, y: 1.85, z: -0.1 } },
  { id: 'interior', label: 'Interior', region: 'side',
    slugAliases: ['interior'], position: { x: 47.5, y: 31.7 }, anchor3d: { x: 0.6, y: 1.3, z: -0.1 } },
  { id: 'audio', label: 'Audio', region: 'interior',
    slugAliases: ['audio', 'infotainment-system'], position: { x: 53.0, y: 33.9 }, anchor3d: { x: 0.35, y: 1.2, z: -0.8 } },
  { id: 'suspension', label: 'Suspension', region: 'wheel',
    slugAliases: ['suspension'], position: { x: 54.0, y: 48.2 }, anchor3d: { x: 1.0, y: 0.5, z: -1.6 } },
  { id: 'brakes', label: 'Brakes', region: 'wheel',
    slugAliases: ['brakes', 'brake-kit'], position: { x: 37.0, y: 41.3 }, anchor3d: { x: 1.0, y: 0.4, z: 1.7 } },

  // Abstract hubs — no natural point on the vehicle → chips beside the car.
  { id: 'accessories', label: 'Accessories', region: 'rear', chip: true,
    slugAliases: ['accessories'], position: { x: 0, y: 0 } },
  { id: 'portable-fridge', label: 'Portable Fridge', region: 'rear', chip: true,
    slugAliases: ['portable-fridge'], position: { x: 0, y: 0 } },
];

const normalize = (s: string) =>
  (s || '')
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

/**
 * Resolve hotspots against live categories, linking each to its real slug.
 * Hotspots with no matching active category are dropped (no broken links).
 * Pure + exported for unit testing.
 */
export function resolveCarHotspots(
  categories: ApiCategory[],
  defs: CarHotspotDef[] = CAR_HOTSPOTS
): ResolvedCarHotspot[] {
  const bySlug = new Map<string, ApiCategory>();
  const byName = new Map<string, ApiCategory>();
  for (const c of categories || []) {
    if (c?.isActive === false) continue;
    if (c?.slug) bySlug.set(normalize(c.slug), c);
    if (c?.name) byName.set(normalize(c.name), c);
  }

  const resolved: ResolvedCarHotspot[] = [];
  for (const def of defs) {
    let match: ApiCategory | undefined;
    for (const alias of def.slugAliases) {
      const key = normalize(alias);
      match = bySlug.get(key) || byName.get(key);
      if (match) break;
    }
    if (match?.slug) {
      resolved.push({
        id: def.id,
        label: def.label,
        region: def.region,
        href: `/categories/${match.slug}`,
        position: def.position,
        anchor3d: def.anchor3d,
        chip: def.chip,
      });
    }
  }
  return resolved;
}

/**
 * Static fallback: resolve the hotspots against the config's own (verified,
 * drift-guarded) hub slugs. Used when the live categories API is unreachable or
 * returns nothing, so the explorer still renders against stable `/categories/<hub>`
 * routes rather than disappearing. Mirrors the static fallbacks the other home
 * sections use (homeContent.ts).
 */
export const FALLBACK_CAR_HOTSPOTS: ResolvedCarHotspot[] = resolveCarHotspots(
  CAR_HOTSPOTS.map((h) => ({
    _id: h.id,
    name: h.label,
    slug: h.slugAliases[0],
    isActive: true,
  })),
);

/**
 * Server-side: fetch active categories and resolve the car explorer hotspots.
 * Cached 10 min (categories change rarely). Falls back to FALLBACK_CAR_HOTSPOTS
 * (stable hub slugs) when the fetch fails or returns nothing, so the section
 * always renders.
 */
export async function getCarHotspots(): Promise<ResolvedCarHotspot[]> {
  try {
    const data = await serverFetch<{ categories?: ApiCategory[] }>(
      '/categories?limit=400',
      { next: { revalidate: 600 } }
    );
    const resolved = resolveCarHotspots(data?.categories ?? []);
    return resolved.length ? resolved : FALLBACK_CAR_HOTSPOTS;
  } catch {
    return FALLBACK_CAR_HOTSPOTS;
  }
}
