import { parentIdOf, type CategoryItem } from '@/hooks/queries/useCategories';

/**
 * Resolve what `?category=` MEANS on a single category page.
 *
 * The filter sidebar writes the same `category` param the global listing uses,
 * but on `/categories/<slug>` it can only ever be a refinement INSIDE that hub —
 * never a jump to a different one. So only ids that are genuinely the hub's
 * children are honoured; anything else falls back to the hub itself.
 *
 * Both halves matter:
 *
 *  - Without the refinement, a sidebar selection moved the checkbox and the URL
 *    and changed nothing else, because the page always queried the hub id. Dead
 *    controls are worse than absent ones.
 *  - Without the containment check, a stale bookmark such as
 *    `/categories/audio?category=<brakes-id>` would render Brakes products under
 *    an Audio heading, an Audio breadcrumb and Audio metadata.
 *
 * The taxonomy is two levels deep, so "children of the hub" IS its whole subtree.
 *
 * `fetchCategories` is injected rather than called directly so this shares the
 * chip strip's cached taxonomy query instead of issuing a second identical
 * request; it is only invoked when a refinement is actually present. That query
 * follows pagination — when it did not, the capped `/categories` response hid 95
 * of 283 children and every one of their checkboxes silently did nothing.
 *
 * @returns a value for the API's `category` param — the hub id, or a
 *          comma-separated list of its children.
 */
export async function resolveCategoryScope(
  hubId: string,
  requested: string[],
  fetchCategories: () => Promise<CategoryItem[]>
): Promise<string> {
  if (requested.length === 0) return hubId;

  try {
    const categories = await fetchCategories();
    const childIds = new Set(
      categories
        .filter((c) => parentIdOf(c) === String(hubId))
        .map((c) => String(c._id))
    );
    const kept = requested.filter((id) => childIds.has(id));
    return kept.length > 0 ? kept.join(',') : hubId;
  } catch {
    // Taxonomy unavailable: fall back to the hub. Showing the whole category is
    // correct-but-broad; honouring an unverified id risks showing the wrong one.
    return hubId;
  }
}
