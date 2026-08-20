import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductTierPanel from './ProductTierPanel';
import apiClient from '@/lib/api';

/**
 * The review step is the whole reason this screen exists, so that is what these pin:
 * a preview writes nothing, deselection is honoured, the typo refusal surfaces before
 * the operator commits, and overlap says plainly where a product will actually land.
 */
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;

const TIERS = [
  { code: 'bronkz', label: 'Bronkz', percent: 3 },
  { code: 'thanos', label: 'Thanos', percent: 8 },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

const product = (id: string, name: string, over = {}) => ({
  id, name, slug: id, brand: null, price: 1000, originalPrice: null,
  onSale: false, currentTier: null, resultingTier: 'bronkz', ...over,
});

const listPage = (over = {}) => ({
  rows: [], nextCursor: null, counts: { bronkz: 2 }, tiers: TIERS, ...over,
});

/** Route each GET by URL so the list and the preview can answer differently. */
const routeGets = (preview: unknown, page = listPage()) =>
  get.mockImplementation((url: string) =>
    Promise.resolve(url.includes('/preview') ? preview : page));

const renderPanel = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProductTierPanel campaignId="c1" />
    </QueryClientProvider>,
  );
};

const runPreview = async (query = 'proman', tier = 'bronkz') => {
  fireEvent.change(await screen.findByLabelText('Tier'), { target: { value: tier } });
  fireEvent.change(screen.getByPlaceholderText(/Search query/i), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
};

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('ProductTierPanel', () => {
  it('shows the ladder with each tier’s rate and how many products it holds', async () => {
    routeGets(null);
    renderPanel();

    expect(await screen.findByText('Bronkz')).toBeInTheDocument();
    expect(screen.getByText('3%')).toBeInTheDocument();
    expect(screen.getByText('· 2')).toBeInTheDocument();
    // The default has no membership by construction, so it must not show a count that
    // implies it does.
    expect(screen.getByText(/everything else/)).toBeInTheDocument();
  });

  it('explains itself instead of rendering an empty table when no ladder is configured', async () => {
    routeGets(null, listPage({ tiers: [] }));
    renderPanel();
    expect(await screen.findByText(/no product-tier ladder yet/i)).toBeInTheDocument();
  });

  it('previews without writing anything', async () => {
    routeGets({
      query: 'proman', tierCode: 'bronkz', matched: 2, catalogueTotal: 928,
      ratio: 0.0022, truncated: false, requiresConfirmation: false, warning: null,
      onSaleCount: 0, movedByOverlap: 0,
      products: [product('p1', 'Proman Bumper'), product('p2', 'Proman Roll Bar')],
    });
    renderPanel();
    await runPreview();

    expect(await screen.findByText('Proman Bumper')).toBeInTheDocument();
    // A preview that could write would defeat the point of previewing.
    expect(post).not.toHaveBeenCalled();
  });

  it('commits only the products still selected after review', async () => {
    routeGets({
      query: 'proman', tierCode: 'bronkz', matched: 2, catalogueTotal: 928,
      ratio: 0.0022, truncated: false, requiresConfirmation: false, warning: null,
      onSaleCount: 0, movedByOverlap: 0,
      products: [product('p1', 'Proman Bumper'), product('p2', 'Wrongly Matched')],
    });
    post.mockResolvedValue({ assigned: 1 });
    renderPanel();
    await runPreview();

    // Drop the product the query dragged in — the reason the review step exists.
    fireEvent.click(await screen.findByLabelText('Include Wrongly Matched'));
    fireEvent.click(screen.getByRole('button', { name: /Assign 1 product$/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ tierCode: 'bronkz', productIds: ['p1'] });
  });

  it('warns about a query that sweeps up the catalogue, and only then sends confirm', async () => {
    // The `cbmcup` case: a typo that matched 928 of 938 products. The operator must see
    // it before committing, not discover it in a customer's cart.
    routeGets({
      query: 'cbmcup', tierCode: 'bronkz', matched: 928, catalogueTotal: 938,
      ratio: 0.9893, truncated: false, requiresConfirmation: true,
      warning: 'This query matches an implausibly large share of the catalogue — it is usually a typo.',
      onSaleCount: 0, movedByOverlap: 0,
      products: [product('p1', 'Unrelated Suspension Kit')],
    });
    post.mockResolvedValue({ assigned: 928 });
    renderPanel();
    await runPreview('cbmcup');

    expect(await screen.findByText(/usually a typo/i)).toBeInTheDocument();
    expect(screen.getByText(/98.9% of 938 active products/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Assign 1 product$/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ confirm: true });
  });

  it('does not send confirm for an ordinary query', async () => {
    routeGets({
      query: 'proman', tierCode: 'bronkz', matched: 1, catalogueTotal: 928,
      ratio: 0.001, truncated: false, requiresConfirmation: false, warning: null,
      onSaleCount: 0, movedByOverlap: 0, products: [product('p1', 'Proman Bumper')],
    });
    post.mockResolvedValue({ assigned: 1 });
    renderPanel();
    await runPreview();

    fireEvent.click(await screen.findByRole('button', { name: /Assign 1 product$/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ confirm: false });
  });

  it('says where an overlapping product will actually land, before committing', async () => {
    routeGets({
      query: 'profender', tierCode: 'thanos', matched: 1, catalogueTotal: 928,
      ratio: 0.001, truncated: false, requiresConfirmation: false, warning: null,
      onSaleCount: 0, movedByOverlap: 1,
      products: [product('p1', 'Profender Thar Lift Kit', {
        currentTier: 'bronkz', resultingTier: 'bronkz',
      })],
    });
    renderPanel();
    await runPreview('profender', 'thanos');

    // Committed to Thanos (8%) but lowest-wins keeps it in Bronkz (3%).
    expect(await screen.findByText(/stays Bronkz/)).toBeInTheDocument();
    expect(screen.getByText(/already sit in a lower tier/)).toBeInTheDocument();
  });

  it('flags already-discounted products as capped at 2%', async () => {
    routeGets({
      query: 'profender', tierCode: 'thanos', matched: 1, catalogueTotal: 928,
      ratio: 0.001, truncated: false, requiresConfirmation: false, warning: null,
      onSaleCount: 1, movedByOverlap: 0,
      products: [product('p1', 'Profender Storm Kit', {
        price: 268000, originalPrice: 282000, onSale: true, resultingTier: 'thanos',
      })],
    });
    renderPanel();
    await runPreview('profender', 'thanos');

    expect(await screen.findByText(/on offer → 2%/)).toBeInTheDocument();
    expect(screen.getByText(/1.*already on offer/)).toBeInTheDocument();
  });

  it('surfaces a server refusal rather than failing silently', async () => {
    get.mockImplementation((url: string) =>
      url.includes('/preview')
        ? Promise.reject(new Error('Unknown tier "nope" on this campaign'))
        : Promise.resolve(listPage()));
    renderPanel();
    await runPreview();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Unknown tier/);
  });

  it('shows why a product is in its tier, not just which tier', async () => {
    routeGets(null, listPage({
      rows: [{
        _id: 'r1', tierCode: 'bronkz', matchedCodes: ['bronkz', 'thanos'],
        matchedQueries: ['profender thar'], source: 'query',
        product: { _id: 'p1', name: 'Profender Thar Lift Kit', slug: 'x', price: 1000, originalPrice: null, brand: null },
      }],
    }));
    renderPanel();

    expect(await screen.findByText('Profender Thar Lift Kit')).toBeInTheDocument();
    expect(screen.getByText('Bronkz · 3%')).toBeInTheDocument();
    // The audit trail: it also matched Thanos, and lowest-wins put it here. Scoped to
    // the cell — "Thanos" also appears as a ladder button, and matching either would
    // let this pass while the explanation column was empty.
    expect(screen.getByRole('cell', { name: 'Thanos' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'profender thar' })).toBeInTheDocument();
  });
});
