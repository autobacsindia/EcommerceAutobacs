import type { Metadata } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import { buildPageMetadata } from '@/lib/pageSeo';
import CareersApplication from './CareersApplication';

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

export default function CareersPage() {
  return (
    <div className={`${bebas.variable} ${inter.variable}`}>
      <CareersApplication />
    </div>
  );
}
