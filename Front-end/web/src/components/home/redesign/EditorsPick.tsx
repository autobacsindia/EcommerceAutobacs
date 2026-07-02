import EditorsPickTrack from './EditorsPickTrack';
import EditorsPickCarousel from './EditorsPickCarousel';
import { type ProductItem } from './homeContent';

/**
 * Featured "Editor's Pick" products, presented two ways from the same DB-driven
 * data, chosen purely by CSS `display` guards (see home-redesign.css):
 *   • desktop (≥1025px): multi-card sliding track with progress bar (EditorsPickTrack)
 *   • phone/tablet (≤1024px): basic single-slide carousel with arrows + dots (EditorsPickCarousel)
 *
 * Both are rendered rather than JS-swapped so the correct variant is already in
 * the SSR HTML for its breakpoint — no post-hydration layout shift. The hidden
 * variant's lazy images aren't fetched while `display:none`.
 */
export default function EditorsPick({ products }: { products?: ProductItem[] }) {
  return (
    <>
      <EditorsPickTrack products={products} />
      <EditorsPickCarousel products={products} />
    </>
  );
}
