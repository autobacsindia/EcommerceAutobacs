import HomeRedesign from '@/components/home/redesign/HomeRedesign';

/**
 * Home page — redesigned (Hero.html).
 *
 * The redesign ships its own fixed nav + footer, so the global Header/Footer
 * are suppressed on `/` (see ConditionalHeader / ConditionalFooter). The whole
 * tree is scoped under `.hr` (components/home/redesign/home-redesign.css), uses
 * Montserrat via the `--font-montserrat` variable wired in app/layout.tsx, and
 * pulls all copy + imagery from components/home/redesign/homeContent.ts so the
 * design can be re-skinned without touching component code.
 */
export default function Home() {
  return <HomeRedesign />;
}
