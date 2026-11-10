import { render, screen, waitFor } from '@testing-library/react';
import ArticleListPage, { type Article } from './ArticleListPage';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const article = (i: number): Article => ({ _id: String(i), title: `Post ${i}`, slug: `post-${i}`, type: 'blog', coverImage: `https://img.example.com/${i}.jpg` } as Article);
const initial = { articles: [article(1), article(2), article(3)], pagination: { page: 1, limit: 12, total: 3, pages: 1 } as never };

describe('blog list', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => ({
      json: async () => (url.includes('articles-categories') ? { success: true, data: [] } : { success: true, data: [article(9)], pagination: null }),
    })) as never;
  });

  it('uses the server first page without fetching it again', async () => {
    render(<ArticleListPage type="blog" initial={initial} />);
    expect(await screen.findByAltText('Post 1')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/media/articles?'));
  });

  it('loads only the first picture straight away', async () => {
    render(<ArticleListPage type="blog" initial={initial} />);
    expect(await screen.findByAltText('Post 1')).toHaveAttribute('loading', 'eager');
    expect(screen.getByAltText('Post 2')).toHaveAttribute('loading', 'lazy');
  });

  it('still fetches for itself when the server had nothing to give', async () => {
    render(<ArticleListPage type="blog" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/media/articles?')));
    expect(await screen.findByAltText('Post 9')).toBeInTheDocument();
  });
});
