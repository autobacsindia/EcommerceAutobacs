import HomeRedesign from '@/components/home/redesign/HomeRedesign';
import { getHomeData } from '@/components/home/redesign/homeData';

/**
 * Home page — redesigned (Hero.html).
 *
 * Server Component: the DB-backed sections (featured products, category hubs,
 * testimonials, blog posts, brands) are fetched server-side via getHomeData()
 * and passed into the client tree as props — so the page ships real content in
 * its initial HTML (SEO + no loading flash). Each section degrades to a static
 * placeholder if its endpoint is empty/down (see homeData.ts).
 *
 * The redesign ships its own fixed nav + footer, so the global Header/Footer
 * are suppressed on `/` (see ConditionalHeader / ConditionalFooter). The whole
 * tree is scoped under `.hr` (components/home/redesign/home-redesign.css), uses
 * Montserrat via the `--font-montserrat` variable wired in app/layout.tsx, and
 * pulls all copy + curated imagery from components/home/redesign/homeContent.ts.
 */

// ISR: refresh the home page's DB-backed data at most every 5 minutes.
export const revalidate = 300;

export default async function Home() {
  const data = await getHomeData();
  return <HomeRedesign data={data} />;
}
