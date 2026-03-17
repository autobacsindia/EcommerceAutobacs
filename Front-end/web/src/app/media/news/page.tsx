import ArticleListPage from '../ArticleListPage';

export const metadata = {
  title: 'News | Autobacs India',
  description: 'Latest news, product launches and company announcements from Autobacs India.',
};

export default function NewsPage() {
  return <ArticleListPage type="news" />;
}
