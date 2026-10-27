import { slugToSearchWords } from '@/lib/legacySearchRedirect';

/**
 * Where a dead WooCommerce-era URL should go, now that it may NOT go to
 * /products/search: that page is noindex (and was robots-disallowed then), so every
 * permanent redirect into it told Google "this page moved to a page you may not
 * read" — Search Console then listed hundreds of /model/<tag> URLs as blocked.
 *
 * Instead, a dead slug goes to a real page that matches it, or nowhere (404):
 *   - a vehicle, when the slug names one ("hilux-led-lights" → /model/toyota-hilux)
 *   - a product, when the slug is that product's name give or take a word (a
 *     renamed product, a WordPress "-2" duplicate)
 * Pure, so the matching rules are unit-tested without the network.
 */

export type LegacyVehicle = { slug: string; make?: string; model?: string };
export type LegacyProduct = { slug: string };

const tokens = (s: string) => slugToSearchWords(s).split(' ').filter(Boolean);
const slugify = (s: string) => tokens(String(s).replace(/[^a-z0-9]+/gi, '-'));

/** Does `needle` appear as consecutive words inside `hay`? */
function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/**
 * The vehicle a slug names. Make + model ("toyota-hilux") beats the model alone
 * ("hilux"); a longer model beats a shorter one ("innova-hycross" over "innova").
 * Returns how many of the slug's words the match covered, so the caller can tell
 * "this slug IS a vehicle" from "this slug mentions one".
 */
export function matchVehicle(slug: string, vehicles: LegacyVehicle[]): { slug: string; covers: number } | null {
  const words = tokens(slug);
  let best: { slug: string; covers: number; score: number } | null = null;
  for (const v of vehicles) {
    const full = tokens(v.slug);
    const model = v.model ? slugify(v.model) : [];
    let covers = 0;
    let score = 0;
    if (containsRun(words, full)) { covers = full.length; score = 100 + full.length; }
    else if (containsRun(words, model)) { covers = model.length; score = model.length; }
    if (score && (!best || score > best.score)) best = { slug: v.slug, covers, score };
  }
  return best && { slug: best.slug, covers: best.covers };
}

/** Share of words two slugs have in common (Jaccard). 1 = same words. */
export function wordOverlap(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  x.forEach((w) => { if (y.has(w)) both += 1; });
  return both / (x.size + y.size - both);
}

/** How alike a product's slug must be to count as "the same product, renamed". */
export const PRODUCT_MATCH = 0.6;

export function matchProduct(slug: string, products: LegacyProduct[]): string | null {
  let best: { slug: string; o: number } | null = null;
  for (const p of products) {
    if (!p?.slug || p.slug === slug) continue;
    const o = wordOverlap(slug, p.slug);
    if (o >= PRODUCT_MATCH && (!best || o > best.o)) best = { slug: p.slug, o };
  }
  return best?.slug ?? null;
}

/**
 * The page a dead slug should permanently redirect to, or null for a 404.
 * `kind` is where the dead URL lived: an old product page tries the product
 * first; an old /model/ tag archive (a listing) tries the vehicle first.
 */
export function legacyTarget(
  slug: string,
  kind: 'product' | 'model',
  { vehicles, products }: { vehicles: LegacyVehicle[]; products: LegacyProduct[] },
): string | null {
  const vehicle = matchVehicle(slug, vehicles);
  const product = matchProduct(slug, products);
  const toVehicle = vehicle ? `/model/${vehicle.slug}` : null;
  const toProduct = product ? `/products/${product}` : null;
  if (kind === 'model') return toVehicle ?? toProduct;
  // A product URL that is nothing but a vehicle's name ("bmw-5-series") is that vehicle.
  if (vehicle && vehicle.covers >= tokens(slug).length) return toVehicle;
  return toProduct ?? toVehicle;
}
