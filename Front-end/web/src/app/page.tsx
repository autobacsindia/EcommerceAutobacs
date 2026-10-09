import StoreHome from '@/components/home/store/StoreHome';
import { getStoreHomeData } from '@/components/home/store/storeData';
import { getActivePromoBanner } from '@/lib/promoBanner';
import { getNavCategories } from '@/lib/navCategories';

/**
 * Home page — the light, Amazon-style store (components/home/store).
 *
 * Server Component: every shelf (deals, best sellers, category rows, new
 * arrivals, brands, reviews) is fetched server-side by getStoreHomeData() and
 * shipped in the initial HTML (SEO, no loading flash). Each section degrades to
 * empty and an empty shelf is not rendered — see storeData.ts.
 *
 * The page ships its own header and footer, so the global Header/Footer are
 * suppressed on `/` (see ConditionalHeader / ConditionalFooter). Styles are
 * scoped under `.sh` / `.sf` (components/home/store/store.css).
 */

// ISR: refresh the home page's data at most every 5 minutes (and on-demand via the
// same `home:*` cache tags the admin write paths already revalidate).
export const revalidate = 300;

export default async function Home() {
  // Independent reads — the promo strip never waits on the heavier shelves.
  // The header uses the same curated department list as every other page.
  const [data, promoBanner, nav] = await Promise.all([getStoreHomeData(), getActivePromoBanner(), getNavCategories()]);
  return <StoreHome data={data} promoBanner={promoBanner} nav={nav.map((c) => ({ name: c.label, href: c.href }))} />;
}
