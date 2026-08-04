/**
 * Layout for the PDP recommendation rails (Similar Products, Frequently Bought
 * Together).
 *
 * Below `sm` a 1-column grid stacked the cards vertically, pushing the rest of
 * the page down by four full cards. On phones the rail is instead a snapping,
 * edge-to-edge horizontal carousel; from `sm` up it reverts to the grid.
 *
 * Kept here (rather than inline) so the two rails — and their loading
 * skeletons — can't drift apart.
 */

/**
 * How many cards each rail requests. Also drives the skeleton count so the
 * placeholder and the loaded rail occupy the same space (no layout shift).
 * The backend clamps this server-side; see RECO_LIMIT_MAX in productController.
 */
export const RAIL_LIMIT = 9;

/** Applies to the container wrapping the cards. */
export const RAIL_CONTAINER =
  'flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth overscroll-x-contain ' +
  // Bleed past the section's px-4 so the rail runs to the screen edge, and hide
  // the scrollbar (the snap points + partial next card are the affordance).
  '-mx-4 px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
  // 3 columns at lg so RAIL_LIMIT lands as a full 3x3 with no orphan row.
  'sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3';

/** Applies to each card (and each skeleton) inside RAIL_CONTAINER. */
export const RAIL_ITEM = 'w-[78%] shrink-0 snap-start sm:w-auto';

/** `sizes` for a card image, matching the widths above. */
export const RAIL_IMAGE_SIZES = '(max-width: 640px) 78vw, (max-width: 1024px) 50vw, 33vw';
