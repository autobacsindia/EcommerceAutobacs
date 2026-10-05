import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';
import ArticleListPage from '../media/ArticleListPage';

// Wired into the config-driven SEO system (admin override -> this fallback -> site
// default). The old hand-written metadata set no canonical, so /blog and every
// /blog?search=… variant inherited the root layout's homepage canonical, and its
// title repeated the suffix the root template already appends.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/blog', {
    title: 'Blog',
    description: 'Expert automotive tips, guides and insights from Autobacs India.',
  });

export default function BlogPage() {
  return <ArticleListPage type="blog" />;
}
