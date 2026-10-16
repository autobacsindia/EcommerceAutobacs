/**
 * The product list remembers where you were. Opening a product and saving it
 * must bring the admin back to the same page/search/filters, not page 1 — the
 * SEO team works through the list page by page.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminProductsPage from './page';

const replace = jest.fn();
const push = jest.fn();
let params = new URLSearchParams();
jest.mock('next/navigation', () => ({
  // lib/usePanel reads the path to pick admin vs the marketing panel.
  usePathname: () => '/admin/products',
  useSearchParams: () => params,
  useRouter: () => ({ replace, push }),
}));
const get = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), delete: jest.fn(), patch: jest.fn() } }));
jest.mock('@/lib/revalidateHome', () => ({ revalidateHome: jest.fn() }));
jest.mock('@/components/admin/ExportProductsButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/admin/SeoScoreBadge', () => ({ __esModule: true, default: () => null }));

const product = { _id: 'p1', name: 'Steering wheel', price: 1000, stock: 1, isActive: true, images: [], categories: [] };

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminProductsPage />
    </QueryClientProvider>,
  );

beforeEach(() => {
  replace.mockReset();
  get.mockReset();
  get.mockResolvedValue({ products: [product], total: 500, pages: 10 });
});

it('opens on the page, search and filter in the URL', async () => {
  params = new URLSearchParams('page=4&q=wheel&status=active');
  renderPage();
  await waitFor(() => expect(get).toHaveBeenCalled());
  const url = String(get.mock.calls[0][0]);
  expect(url).toMatch(/page=4/);
  expect(url).toMatch(/search=wheel/);
  expect(url).toMatch(/status=active/);
  // Nothing on load may reset the restored page back to 1.
  expect(replace).not.toHaveBeenCalledWith(expect.not.stringMatching(/page=4/), expect.anything());
});

it('each edit link carries the current list view as returnTo', async () => {
  params = new URLSearchParams('page=4&status=active');
  renderPage();
  const link = await screen.findByRole('link', { name: /edit/i });
  const returnTo = new URL(link.getAttribute('href')!, 'http://x').searchParams.get('returnTo');
  expect(returnTo).toBe('/admin/products?status=active&page=4');
});

it('ignores a junk page or filter in the URL', async () => {
  params = new URLSearchParams('page=abc&status=deleted');
  renderPage();
  await waitFor(() => expect(get).toHaveBeenCalled());
  const url = String(get.mock.calls[0][0]);
  expect(url).toMatch(/page=1/);
  expect(url).not.toMatch(/status=/);
});
