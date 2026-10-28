/**
 * The URL params the listing filters own. "Clear all" removes exactly these and
 * leaves everything else — the search term (`q`), the sort — where it was.
 */
export const FILTER_PARAMS = [
  'category', 'brand', 'rating', 'minPrice', 'maxPrice', 'inStock', 'vehicleMake', 'vehicleModel',
] as const;
