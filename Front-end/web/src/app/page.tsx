import StoreHome from '@/components/home/store/StoreHome';
import { getStoreHomeData } from '@/components/home/store/storeData';

/**
 * Home page — the light, Amazon-style store (components/home/store).
 *
 * Server Component: every shelf (deals, best sellers, category rows, new
 * arrivals, brands, reviews) is fetched server-side by getStoreHomeData() and
 * shipped in the initial HTML (SEO, no loading flash). Each section degrades to
 * empty and an empty shelf is not rendered — see storeData.ts.
 *
 * The header, promo strip and footer come from the root layout like every other
 * page — one copy, never two. Styles: components/home/store/store.css.
 */

// ISR: refresh the home page's data at most every 5 minutes (and on-demand via the
// same `home:*` cache tags the admin write paths already revalidate).
export const revalidate = 300;

export default async function Home() {
  // Independent reads — the promo strip never waits on the heavier shelves.
  // Header, promo strip and footer come from the root layout, as on every page.
  return <StoreHome data={await getStoreHomeData()} />;
}
