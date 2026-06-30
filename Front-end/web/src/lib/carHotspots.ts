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
  /** Stable id (analytics, React key, mesh name for a future glTF upgrade). */
  id: string;
  /** Human label shown in the tooltip / accessible link text. */
  label: string;
  region: CarRegion;
  /** Ordered preference — first alias that matches a live category wins. */
  slugAliases: string[];
  /** Overlay anchor as % of the artwork box. Tune to the shipped asset. */
  position: { x: number; y: number };
}

export interface ResolvedCarHotspot {
  id: string;
  label: string;
  region: CarRegion;
  href: string;
  position: { x: number; y: number };
}

interface ApiCategory {
  _id?: string;
  name?: string;
  slug?: string;
  isActive?: boolean;
}

/**
 * Curated hotspot set. Each primary alias is a verified live slug; later aliases
 * are graceful fallbacks if the catalog is re-homed. Buyer-intent parts first —
 * ship this set, expand later. Positions assume a 3/4 front-left hero render;
 * realign once the artwork lands.
 */
export const CAR_HOTSPOTS: CarHotspotDef[] = [
  // FRONT
  { id: 'headlight', label: 'Headlights', region: 'front',
    slugAliases: ['headlight', 'projector-headlights-2'], position: { x: 24, y: 47 } },
  { id: 'front-grill', label: 'Front Grille', region: 'front',
    slugAliases: ['front-grill', 'grill', 'front-bumper-grill'], position: { x: 17, y: 55 } },
  { id: 'bumper', label: 'Front Bumper', region: 'front',
    slugAliases: ['bumper', 'bumper-bar'], position: { x: 14, y: 66 } },
  { id: 'fog-lamp', label: 'Fog Lamps', region: 'front',
    slugAliases: ['fog-lamp', 'fog-lamps'], position: { x: 19, y: 70 } },
  { id: 'bullbar', label: 'Bull Bar', region: 'front',
    slugAliases: ['bullbar', 'bash-plate'], position: { x: 11, y: 72 } },

  // HOOD / ENGINE
  { id: 'bonnet', label: 'Bonnet / Hood', region: 'hood',
    slugAliases: ['bonnet', 'bonnet-hood', 'bonnet-scoop'], position: { x: 33, y: 40 } },
  { id: 'snorkel', label: 'Snorkel', region: 'hood',
    slugAliases: ['snorkel', 'safari-snorkels'], position: { x: 38, y: 34 } },
  { id: 'exhaust', label: 'Exhaust & Intake', region: 'hood',
    slugAliases: ['exhaust', 'air-intake-systems', 'electronic-exhaust-system'], position: { x: 30, y: 78 } },

  // ROOF
  { id: 'roof-rack', label: 'Roof Rack', region: 'roof',
    slugAliases: ['roof-rack', 'roof-rail', 'roof-carrier-2'], position: { x: 47, y: 22 } },
  { id: 'lightbar', label: 'Light Bar', region: 'roof',
    slugAliases: ['lightbar', 'roof-light-bar', 'bar-light'], position: { x: 40, y: 19 } },

  // SIDE
  { id: 'mirrors', label: 'Mirrors', region: 'side',
    slugAliases: ['mirrors', 'mirror-cover'], position: { x: 45, y: 41 } },
  { id: 'side-steps', label: 'Side Steps', region: 'side',
    slugAliases: ['side-steps', 'side-step', 'foot-step'], position: { x: 55, y: 73 } },
  { id: 'fender-flares', label: 'Fender Flares', region: 'side',
    slugAliases: ['fender-flares', 'fender-flare', 'flexy-flares'], position: { x: 64, y: 62 } },
  { id: 'door-visor', label: 'Door Visors', region: 'side',
    slugAliases: ['door-visor', 'gr-door-beading'], position: { x: 52, y: 46 } },

  // WHEEL / UNDERCARRIAGE
  { id: 'suspension', label: 'Suspension', region: 'wheel',
    slugAliases: ['suspension', 'coilovers', 'shock-absorbers'], position: { x: 70, y: 78 } },
  { id: 'brakes', label: 'Brakes', region: 'wheel',
    slugAliases: ['brake-kit', 'brake-rotors', 'brakes'], position: { x: 67, y: 82 } },

  // REAR
  { id: 'tail-light', label: 'Tail Lights', region: 'rear',
    slugAliases: ['tail-light', 'rear-light'], position: { x: 88, y: 50 } },
  { id: 'spoiler', label: 'Spoiler', region: 'rear',
    slugAliases: ['spoiler', 'spoilers', 'spoiler-lip'], position: { x: 84, y: 33 } },
  { id: 'tonneau', label: 'Bed / Tonneau Cover', region: 'rear',
    slugAliases: ['tonneau-covers', 'tri-fold-cover', 'roller-shutter'], position: { x: 78, y: 40 } },

  // INTERIOR (second-layer / "step inside")
  { id: 'seat-cover', label: 'Seat Covers', region: 'interior',
    slugAliases: ['seat-cover', 'seat'], position: { x: 60, y: 50 } },
  { id: 'infotainment', label: 'Infotainment', region: 'interior',
    slugAliases: ['infotainment-system', 'android-screen', 'android-car-stereo'], position: { x: 48, y: 53 } },
  { id: 'steering', label: 'Steering Wheel', region: 'interior',
    slugAliases: ['steering-wheel', 'steering-trims'], position: { x: 50, y: 58 } },
  { id: 'floor-mats', label: 'Floor Mats', region: 'interior',
    slugAliases: ['floor-mats', 'floor-mat'], position: { x: 55, y: 72 } },
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
      });
    }
  }
  return resolved;
}

/**
 * Server-side: fetch active categories and resolve the car explorer hotspots.
 * Cached 10 min (categories change rarely). Returns [] on failure so the section
 * can self-hide rather than render a broken explorer.
 */
export async function getCarHotspots(): Promise<ResolvedCarHotspot[]> {
  try {
    const data = await serverFetch<{ categories?: ApiCategory[] }>(
      '/categories?limit=400',
      { next: { revalidate: 600 } }
    );
    return resolveCarHotspots(data?.categories ?? []);
  } catch {
    return [];
  }
}
