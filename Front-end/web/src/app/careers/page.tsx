import type { Metadata } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import { buildPageMetadata } from '@/lib/pageSeo';
import { getServerApiBase } from '@/lib/server-api';
import CareersApplication, { type CareerPosting } from './CareersApplication';

// Self-hosted via next/font (CSP blocks fonts.gstatic.com). Exposed as CSS
// variables the ported inline styles reference (--font-bebas / --font-inter).
const bebas = Bebas_Neue({
  variable: '--font-bebas',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
});

export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/careers', {
    title: 'Careers',
    description:
      'We don’t hire for titles — we hire for impact. Join Roavion Automotive (Autobacs India) and help build India’s premium automotive ecosystem.',
  });

// Open roles are now admin-managed (JobPosting) and fetched server-side. ISR: a
// short revalidate bounds staleness, and the 'careers:list' tag lets a publish/
// edit/withdraw refresh this page on demand (the bare 'careers' used before
// matched no allowlisted prefix, so no write could ever purge it).
async function getOpenPostings(): Promise<CareerPosting[]> {
  try {
    const res = await fetch(`${getServerApiBase()}/careers/postings`, {
      next: { revalidate: 300, tags: ['careers:list'] },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.postings) ? data.postings : [];
  } catch {
    // A careers backend hiccup must never 500 the page — render the static shell
    // with the open-application fallback instead.
    return [];
  }
}

export default async function CareersPage() {
  const postings = await getOpenPostings();
  return (
    <div className={`${bebas.variable} ${inter.variable}`}>
      <CareersApplication postings={postings} />
    </div>
  );
}
