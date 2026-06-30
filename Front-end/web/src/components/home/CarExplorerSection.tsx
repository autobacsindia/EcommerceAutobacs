// PARKED (2026-06-29): built + tested but intentionally NOT mounted, pending the
// full UI revamp. To re-enable: import this and render <CarExplorerSection /> in
// the new home/discovery page. Data layer (lib/carHotspots.ts) + tests are live
// and revamp-proof; only InteractiveCarExplorer needs re-skinning to the new UI.
// Find everything: `git grep -i car-explorer`.
import { getCarHotspots } from '@/lib/carHotspots';
import InteractiveCarExplorer from './InteractiveCarExplorer';

/**
 * Server component: resolves hotspots against the live taxonomy (cached 10 min)
 * and renders the interactive explorer. Self-hides if nothing resolves (e.g.
 * categories API down), so a backend hiccup never shows a broken section.
 */
export default async function CarExplorerSection() {
  const hotspots = await getCarHotspots();
  if (!hotspots.length) return null;
  return <InteractiveCarExplorer hotspots={hotspots} />;
}
