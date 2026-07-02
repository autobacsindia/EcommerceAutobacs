import CategoriesScroll from './CategoriesScroll';
import CategoriesCoverflow from './CategoriesCoverflow';
import { type CategoryItem } from './homeContent';

/**
 * Featured-category section. The same DB/admin-driven hub data is presented two
 * ways, chosen purely by CSS `display` guards (see home-redesign.css):
 *   • md/lg (≥769px): pinned horizontal scroll gallery (CategoriesScroll)
 *   • phone (≤768px): 3D coverflow carousel (CategoriesCoverflow)
 *
 * Both variants are rendered rather than JS-swapped on purpose: the correct one
 * is already in the SSR HTML for its breakpoint, so there's no post-hydration
 * layout shift (CLS). The hidden variant costs only a few extra DOM nodes — its
 * lazy images aren't fetched while `display:none`, and the coverflow keeps
 * autoplay paused whenever it isn't visible (IntersectionObserver in the
 * component), which covers both the desktop-hidden and scrolled-offscreen cases.
 */
export default function Categories({ categories }: { categories?: CategoryItem[] }) {
  return (
    <>
      <CategoriesScroll categories={categories} />
      <CategoriesCoverflow categories={categories} />
    </>
  );
}
