import type { Metadata } from 'next';

/**
 * Browser tab / bookmark name for /register — it showed the generic site title.
 * Private page (robots.ts disallows /register, never in the sitemap), so a fixed
 * title and noindex here rather than the PageSeo system.
 */
export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
